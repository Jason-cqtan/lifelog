package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/app"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

var errBusy = errors.New("a sync is already running")

// jobs runs one sync at a time and keeps the running one's log in memory so
// the admin page can follow it.
type jobs struct {
	mu   sync.Mutex
	id   int64
	buf  *lockedBuffer
	done sync.WaitGroup
	ctx  context.Context // set by schedule; cancelled on shutdown
}

func newJobs() *jobs { return &jobs{ctx: context.Background()} }

func (j *jobs) runningID() int64 {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.id
}

func (j *jobs) liveLog(id int64) (string, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.id != id || j.buf == nil {
		return "", false
	}
	return j.buf.String(), true
}

func (j *jobs) wait() { j.done.Wait() }

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// start begins a run in the background: sync (unless syncSources is false),
// export the site, then back up to GitHub when that is turned on.
func (s *Server) start(trigger string, names []string, full, syncSources bool) (int64, error) {
	j := s.jobs
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.id != 0 {
		return 0, errBusy
	}
	label := strings.Join(names, ",")
	if full {
		label = strings.TrimPrefix(label+",full", ",")
	}
	var id int64
	if err := s.pool.QueryRow(j.ctx, `INSERT INTO sync_runs (trigger, sources) VALUES ($1, $2) RETURNING id`,
		trigger, label).Scan(&id); err != nil {
		return 0, err
	}
	j.id, j.buf = id, &lockedBuffer{}
	j.done.Add(1)
	go func() {
		defer j.done.Done()
		logger := log.New(io.MultiWriter(os.Stderr, j.buf), fmt.Sprintf("[run %d] ", id), log.Ltime)
		status := s.runJob(j.ctx, logger, names, full, syncSources)
		// a fresh context: the run's own may be cancelled by shutdown, and the result must still be recorded
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := s.pool.Exec(ctx, `UPDATE sync_runs SET status = $2, finished_at = now(), log = $3 WHERE id = $1`,
			id, status, j.buf.String()); err != nil {
			log.Printf("serve: record run %d: %v", id, err)
		}
		j.mu.Lock()
		j.id, j.buf = 0, nil
		j.mu.Unlock()
	}()
	return id, nil
}

func (s *Server) runJob(ctx context.Context, logger *log.Logger, names []string, full, syncSources bool) (status string) {
	defer func() {
		if p := recover(); p != nil {
			logger.Printf("panic: %v", p)
			status = "failed"
		}
	}()
	// pick up settings changed in the admin page (or by `lifelog auth`) since the last run
	if err := settings.Apply(ctx, s.pool); err != nil {
		logger.Printf("settings: %v", err)
		return "failed"
	}
	st, err := app.OpenStore(ctx, s.pool)
	if err != nil {
		logger.Printf("open: %v", err)
		return "failed"
	}
	status = "ok"
	if syncSources {
		failed, err := app.Sync(ctx, st, names, full, logger)
		if err != nil {
			logger.Printf("save: %v", err)
			return "failed"
		}
		if len(failed) > 0 {
			logger.Printf("failed sources: %s", strings.Join(failed, ", "))
			status = "partial"
		}
	}
	if s.opt.WWW != "" {
		if err := app.ExportSite(st, s.opt.WWW, s.opt.Compress, logger); err != nil {
			logger.Printf("export: %v", err)
			return "failed"
		}
	}
	if syncSources && s.opt.Repo != "" && source.Getenv(settings.GitBackup) == "true" {
		if err := app.GitBackup(ctx, st, s.opt.Repo, logger); err != nil {
			// the site is already up to date; a failed push is retried with the next run
			logger.Printf("backup: %v", err)
			status = "partial"
		}
	}
	logger.Printf("done: %s", status)
	return status
}

// schedule starts a run in each configured hour (LIFELOG_SYNC_HOURS, in
// LIFELOG_TZ) that has none yet; checking against the database means a restart
// mid-hour neither skips nor repeats one.
func (s *Server) schedule(ctx context.Context) {
	s.jobs.mu.Lock()
	s.jobs.ctx = ctx
	s.jobs.mu.Unlock()
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		s.maybeRun(ctx, time.Now())
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *Server) maybeRun(ctx context.Context, now time.Time) {
	loc, err := app.Location()
	if err != nil {
		return
	}
	hours, _ := parseHours(source.Getenv(settings.SyncHours))
	now = now.In(loc)
	due := false
	for _, h := range hours {
		due = due || h == now.Hour()
	}
	if !due {
		return
	}
	hourStart := now.Truncate(time.Hour) // whole-hour zones only; fine for LIFELOG_TZ
	var ran bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sync_runs WHERE trigger = 'schedule' AND started_at >= $1)`,
		hourStart).Scan(&ran); err != nil || ran {
		return
	}
	if _, err := s.start("schedule", nil, false, true); err != nil && !errors.Is(err, errBusy) {
		log.Printf("serve: scheduled sync: %v", err)
	}
}

// nextRun is the start of the next configured sync hour after now.
func (s *Server) nextRun(now time.Time) (time.Time, bool) {
	loc, err := app.Location()
	if err != nil {
		return time.Time{}, false
	}
	hours, _ := parseHours(source.Getenv(settings.SyncHours))
	if len(hours) == 0 {
		return time.Time{}, false
	}
	now = now.In(loc)
	for d := 0; d < 2; d++ {
		best := time.Time{}
		for _, h := range hours {
			t := time.Date(now.Year(), now.Month(), now.Day()+d, h, 0, 0, 0, loc)
			if t.After(now) && (best.IsZero() || t.Before(best)) {
				best = t
			}
		}
		if !best.IsZero() {
			return best, true
		}
	}
	return time.Time{}, false
}

func envValue(key string) string { return strings.TrimSpace(os.Getenv(key)) }
