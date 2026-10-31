// Package server is `lifelog serve`: the admin API behind /api/admin/ and the
// scheduler that syncs at the configured hours. Caddy serves the site and the
// admin page (web/admin) as static files and proxies /api/ here.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/app"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Options struct {
	WWW      string // site directory for data.json
	Repo     string // git checkout for the data/ backup; empty: none
	Compress string // deploy/compress.sh, optional
}

type Server struct {
	pool *pgxpool.Pool
	opt  Options
	jobs *jobs
	auth *auth

	pushMu    sync.Mutex
	pushTimer *time.Timer
}

func New(pool *pgxpool.Pool, opt Options) *Server {
	return &Server{pool: pool, opt: opt, jobs: newJobs(), auth: &auth{pool: pool}}
}

// Run serves until ctx is done, then waits for a running sync to stop.
func (s *Server) Run(ctx context.Context, addr string) error {
	// a sync cut off by a restart never finished
	if _, err := s.pool.Exec(ctx, `UPDATE sync_runs SET status = 'failed', finished_at = now(),
		log = log || E'\n(interrupted: server restarted)' WHERE status = 'running'`); err != nil {
		return err
	}
	srv := &http.Server{Addr: addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	go s.schedule(ctx)
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Printf("serve: admin API on http://%s/api/admin/ (site dir %s)", addr, s.opt.WWW)
	err := srv.ListenAndServe()
	s.jobs.wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": s.pool.Ping(r.Context()) == nil})
	})
	mux.HandleFunc("POST /api/admin/login", s.auth.login)
	mux.HandleFunc("POST /api/admin/logout", s.auth.logout)
	mux.HandleFunc("POST /api/push/applehealth", s.pushAppleHealth)

	private := http.NewServeMux()
	private.HandleFunc("GET /api/admin/me", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	private.HandleFunc("POST /api/admin/password", s.auth.changePassword)
	private.HandleFunc("GET /api/admin/settings", s.getSettings)
	private.HandleFunc("PUT /api/admin/settings", s.putSettings)
	private.HandleFunc("GET /api/admin/overview", s.overview)
	private.HandleFunc("POST /api/admin/sync", s.postSync)
	private.HandleFunc("GET /api/admin/runs", s.listRuns)
	private.HandleFunc("GET /api/admin/runs/{id}", s.getRun)
	mux.Handle("/api/admin/", s.auth.require(private))
	return mux
}

// --- settings

type settingItem struct {
	settings.Def
	Value string `json:"value,omitempty"` // never set for secrets
	Set   bool   `json:"set"`
	// From says where the value in effect comes from: db, env or default.
	From string `json:"from,omitempty"`
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	stored, err := settings.Load(r.Context(), s.pool)
	if err != nil {
		serverError(w, err)
		return
	}
	items := make([]settingItem, 0, len(settings.Defs))
	for _, d := range settings.Defs {
		it := settingItem{Def: d}
		v := stored[d.Key]
		switch {
		case v != "":
			it.From = "db"
		case strings.TrimSpace(envValue(d.Key)) != "":
			v, it.From = envValue(d.Key), "env"
		case d.Default != "":
			v, it.From = d.Default, "default"
		}
		it.Set = v != ""
		if d.Kind != settings.Secret {
			it.Value = v
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Values map[string]string `json:"values"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	for k, v := range body.Values {
		d, ok := settings.Lookup(k)
		if !ok {
			badRequest(w, "未知设置: "+k)
			return
		}
		if msg := validate(d, strings.TrimSpace(v)); msg != "" {
			badRequest(w, d.Label+": "+msg)
			return
		}
	}
	for k, v := range body.Values {
		if err := settings.Set(r.Context(), s.pool, k, strings.TrimSpace(v)); err != nil {
			serverError(w, err)
			return
		}
	}
	if err := settings.Apply(r.Context(), s.pool); err != nil {
		serverError(w, err)
		return
	}
	s.getSettings(w, r)
}

func validate(d settings.Def, v string) string {
	if v == "" {
		return ""
	}
	switch d.Key {
	case "LIFELOG_TZ":
		if _, err := time.LoadLocation(v); err != nil {
			return "不是有效的时区名(如 Asia/Shanghai)"
		}
	case settings.SyncHours:
		if _, err := parseHours(v); err != nil {
			return err.Error()
		}
	case "VITE_MAPBOX_TOKEN":
		if strings.HasPrefix(v, "sk.") {
			return "这是私密 token(sk.*),会出现在网页里;请用公开 token(pk.*)"
		}
	}
	if d.Kind == settings.Bool && v != "true" && v != "false" {
		return "只能是 true 或 false"
	}
	return ""
}

// parseHours reads "8,13,22" into hours of the day.
func parseHours(v string) ([]int, error) {
	var out []int
	for _, f := range strings.Split(v, ",") {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		h, err := strconv.Atoi(f)
		if err != nil || h < 0 || h > 23 {
			return nil, errors.New("应为 0–23 的整点，用逗号分隔，如 8,13,22")
		}
		out = append(out, h)
	}
	return out, nil
}

// --- overview

type sourceStats struct {
	Name       string     `json:"name"`
	Configured bool       `json:"configured"`
	Activities int        `json:"activities"`
	LatestAct  *time.Time `json:"latest_activity,omitempty"`
	DailyRows  int        `json:"daily_rows"`
	LatestDay  string     `json:"latest_day,omitempty"`
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	stats := map[string]*sourceStats{}
	get := func(name string) *sourceStats {
		if stats[name] == nil {
			stats[name] = &sourceStats{Name: name}
		}
		return stats[name]
	}
	for _, src := range app.Sources {
		get(src.Name()).Configured = src.Configured()
	}
	rows, err := s.pool.Query(ctx, `SELECT source, count(*), max(start_time) FROM activities GROUP BY source`)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var name string
		var n int
		var latest time.Time
		if err := rows.Scan(&name, &n, &latest); err != nil {
			serverError(w, err)
			return
		}
		st := get(name)
		st.Activities, st.LatestAct = n, &latest
	}
	rows, err = s.pool.Query(ctx, `SELECT source, count(*), to_char(max(date), 'YYYY-MM-DD') FROM daily_metrics GROUP BY source`)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var name, latest string
		var n int
		if err := rows.Scan(&name, &n, &latest); err != nil {
			serverError(w, err)
			return
		}
		st := get(name)
		st.DailyRows, st.LatestDay = n, latest
	}
	var plays int
	var lastPlay *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT count(*), max(played_at) FROM plays`).Scan(&plays, &lastPlay); err != nil {
		serverError(w, err)
		return
	}
	out := make([]*sourceStats, 0, len(stats))
	for _, name := range app.SourceNames() {
		out = append(out, stats[name])
		delete(stats, name)
	}
	for _, st := range stats { // imported-only sources: applehealth, running_page ...
		out = append(out, st)
	}
	resp := map[string]any{
		"sources":     out,
		"plays":       plays,
		"latest_play": lastPlay,
		"running":     s.jobs.runningID(),
		"git_backup":  s.opt.Repo != "" && source.Getenv(settings.GitBackup) == "true",
		"site_dir":    s.opt.WWW,
	}
	if next, ok := s.nextRun(time.Now()); ok {
		resp["next_run"] = next
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- sync jobs

func (s *Server) postSync(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Sources    []string `json:"sources"`
		Full       bool     `json:"full"`
		ExportOnly bool     `json:"export_only"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	known := map[string]bool{}
	for _, n := range app.SourceNames() {
		known[n] = true
	}
	for _, n := range body.Sources {
		if !known[n] {
			badRequest(w, "未知数据源: "+n)
			return
		}
	}
	trigger := "admin"
	if body.ExportOnly {
		trigger = "admin-export"
	}
	id, err := s.start(trigger, body.Sources, body.Full, !body.ExportOnly)
	if errors.Is(err, errBusy) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "已有同步在运行"})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]int64{"id": id})
}

type run struct {
	ID         int64      `json:"id"`
	Trigger    string     `json:"trigger"`
	Sources    string     `json:"sources"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	Status     string     `json:"status"`
	Log        string     `json:"log,omitempty"`
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id, trigger, sources, started_at, finished_at, status
		FROM sync_runs ORDER BY id DESC LIMIT 30`)
	if err != nil {
		serverError(w, err)
		return
	}
	runs := []run{}
	for rows.Next() {
		var x run
		if err := rows.Scan(&x.ID, &x.Trigger, &x.Sources, &x.StartedAt, &x.FinishedAt, &x.Status); err != nil {
			serverError(w, err)
			return
		}
		runs = append(runs, x)
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		badRequest(w, "bad id")
		return
	}
	var x run
	err = s.pool.QueryRow(r.Context(), `SELECT id, trigger, sources, started_at, finished_at, status, log
		FROM sync_runs WHERE id = $1`, id).Scan(&x.ID, &x.Trigger, &x.Sources, &x.StartedAt, &x.FinishedAt, &x.Status, &x.Log)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if live, ok := s.jobs.liveLog(id); ok {
		x.Log = live
	}
	writeJSON(w, http.StatusOK, x)
}

// --- helpers

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// readJSON also guards against cross-site form posts: only a script on the
// admin page's own origin can send application/json with the session cookie.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		badRequest(w, "expected application/json")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		badRequest(w, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("serve: %v", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}
