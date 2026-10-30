// Package app wires the pieces the CLI and the admin server share: opening the
// store (PostgreSQL when DATABASE_URL is set, else data/), syncing every
// source, and exporting the site.
package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/db"
	"github.com/Jason-cqtan/lifelog/internal/export"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/source/coros"
	"github.com/Jason-cqtan/lifelog/internal/source/duolingo"
	"github.com/Jason-cqtan/lifelog/internal/source/garmin"
	"github.com/Jason-cqtan/lifelog/internal/source/github"
	"github.com/Jason-cqtan/lifelog/internal/source/spotify"
	"github.com/Jason-cqtan/lifelog/internal/source/strava"
	"github.com/Jason-cqtan/lifelog/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

var Sources = []source.Source{
	garmin.Garmin{},
	coros.Coros{},
	strava.Strava{},
	duolingo.Duolingo{},
	spotify.Spotify{},
	github.GitHub{},
}

func SourceNames() []string {
	var names []string
	for _, s := range Sources {
		names = append(names, s.Name())
	}
	return names
}

// DatabaseURL is the one setting that has to come from the environment.
func DatabaseURL() string { return strings.TrimSpace(os.Getenv("DATABASE_URL")) }

// ConnectDB connects, migrates and applies the stored settings; nil without DATABASE_URL.
func ConnectDB(ctx context.Context) (*pgxpool.Pool, error) {
	url := DatabaseURL()
	if url == "" {
		return nil, nil
	}
	pool, err := db.Connect(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := settings.Apply(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func DataDir() string {
	if d := source.Getenv("LIFELOG_DATA"); d != "" {
		return d
	}
	return "data"
}

// OpenStore opens the database when pool is set, else the JSON files in data/.
func OpenStore(ctx context.Context, pool *pgxpool.Pool) (*store.Store, error) {
	if pool != nil {
		return store.OpenDB(ctx, pool)
	}
	return store.Open(DataDir(), source.Getenv("LIFELOG_MAP_ANSWER"))
}

func Location() (*time.Location, error) {
	name := source.Getenv("LIFELOG_TZ")
	if name == "" {
		name = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("LIFELOG_TZ: %w", err)
	}
	return loc, nil
}

// Sync runs every configured source in names (all when empty) and saves the
// store. It returns the sources that failed; one broken source (expired
// token, API change) must not block the others.
func Sync(ctx context.Context, st *store.Store, names []string, full bool, logger *log.Logger) (failed []string, err error) {
	loc, err := Location()
	if err != nil {
		return nil, err
	}
	want := map[string]bool{}
	for _, n := range names {
		want[n] = true
	}
	env := &source.Env{
		Store: st,
		HTTP:  &http.Client{Timeout: 60 * time.Second},
		Loc:   loc,
		Full:  full,
		Log:   logger,
	}
	for _, s := range Sources {
		if len(want) > 0 && !want[s.Name()] {
			continue
		}
		if !s.Configured() {
			if len(want) > 0 {
				failed = append(failed, s.Name()+" (not configured)")
			} else {
				logger.Printf("%s: skipped, not configured", s.Name())
			}
			continue
		}
		start := time.Now()
		logger.Printf("%s: start", s.Name())
		if err := s.Sync(ctx, env); err != nil {
			logger.Printf("%s: FAILED: %v", s.Name(), err)
			failed = append(failed, s.Name())
			continue
		}
		logger.Printf("%s: ok (%s)", s.Name(), time.Since(start).Round(time.Second))
	}
	return failed, st.Save()
}

// MapLock is the map question and its answer; nil leaves routes out.
func MapLock(logger *log.Logger) *export.Lock {
	answer := source.Getenv("LIFELOG_MAP_ANSWER")
	if strings.TrimSpace(answer) == "" {
		logger.Printf("export: LIFELOG_MAP_ANSWER not set, routes left out")
		return nil
	}
	q := source.Getenv("LIFELOG_MAP_QUESTION")
	if q == "" {
		q = "站长姓氏？"
	}
	return &export.Lock{Question: q, Answer: answer}
}

// SiteConfig is what the page reads from data.json instead of build-time VITE_* values.
func SiteConfig() *export.SiteConfig {
	c := &export.SiteConfig{
		MapboxToken: source.Getenv("VITE_MAPBOX_TOKEN"),
		MapGCJ02:    source.Getenv("VITE_MAP_GCJ02") == "true",
	}
	if strings.HasPrefix(c.MapboxToken, "sk.") {
		c.MapboxToken = "" // a secret token must never reach the page
	}
	if *c == (export.SiteConfig{}) {
		return nil
	}
	return c
}

// Export writes data.json (and routes.enc) to path.
func Export(st *store.Store, path string, logger *log.Logger) error {
	loc, err := Location()
	if err != nil {
		return err
	}
	o := export.Build(st, loc)
	o.Config = SiteConfig()
	logger.Printf("export: %d activities, %d days -> %s", len(o.Activities), len(o.Daily), path)
	return export.Write(path, o, MapLock(logger))
}

// ExportSite exports into the served directory www: everything is written to
// www/.next first (with compress.sh's .br/.zst/.gz copies when compress is
// set), then moved in, routes.enc before data.json, so a page never sees a
// data.json pointing at routes it can't open.
func ExportSite(st *store.Store, www, compress string, logger *log.Logger) error {
	next := filepath.Join(www, ".next")
	if err := os.MkdirAll(next, 0o755); err != nil {
		return err
	}
	if err := Export(st, filepath.Join(next, "data.json"), logger); err != nil {
		return err
	}
	if compress != "" {
		if out, err := exec.Command(compress, filepath.Join(next, "data.json")).CombinedOutput(); err != nil {
			return fmt.Errorf("compress: %v: %s", err, out)
		}
	}
	enc := filepath.Join(next, export.RoutesFile)
	if _, err := os.Stat(enc); err == nil {
		if err := os.Rename(enc, filepath.Join(www, export.RoutesFile)); err != nil {
			return err
		}
	} else {
		os.Remove(filepath.Join(www, export.RoutesFile))
	}
	for _, ext := range []string{".br", ".zst", ".gz", ""} {
		from := filepath.Join(next, "data.json"+ext)
		if _, err := os.Stat(from); err != nil {
			os.Remove(filepath.Join(www, "data.json"+ext)) // no stale compressed copy
			continue
		}
		if err := os.Rename(from, filepath.Join(www, "data.json"+ext)); err != nil {
			return err
		}
	}
	return nil
}

// GitBackup writes the store into repo/data as JSON (routes sealed with the map
// answer) and pushes it, so GitHub keeps a copy and Pages stays current.
func GitBackup(ctx context.Context, st *store.Store, repo string, logger *log.Logger) error {
	git := func(args ...string) error {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", repo}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("git %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if err := git("pull", "-q", "--rebase", "--autostash"); err != nil {
		return err
	}
	if err := st.WriteFiles(filepath.Join(repo, "data"), source.Getenv("LIFELOG_MAP_ANSWER")); err != nil {
		return err
	}
	if err := git("add", "data"); err != nil {
		return err
	}
	if git("diff", "--cached", "--quiet") == nil {
		logger.Printf("backup: no changes")
		return nil
	}
	if err := git("commit", "-q", "-m", "sync: "+time.Now().UTC().Format("2006-01-02T15:04Z")+" (vps)"); err != nil {
		return err
	}
	// someone else may have pushed meanwhile; data files are keyed records, so a rebase almost always applies
	if err := git("push", "-q"); err != nil {
		if err := git("pull", "-q", "--rebase"); err != nil {
			return err
		}
		if err := git("push", "-q"); err != nil {
			return err
		}
	}
	logger.Printf("backup: pushed data/ to GitHub")
	return nil
}
