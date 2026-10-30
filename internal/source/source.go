// Package source defines the plug-in interface every data source implements.
package source

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/store"
)

// Env is what a source gets when it syncs.
type Env struct {
	Store *store.Store
	HTTP  *http.Client
	Loc   *time.Location
	// Full re-fetches the whole history instead of only what is newer than the store.
	Full bool
	Log  *log.Logger
}

type Source interface {
	Name() string
	// Configured reports whether the credentials this source needs are present,
	// so `sync` can skip sources the user has not set up.
	Configured() bool
	Sync(ctx context.Context, env *Env) error
}

var (
	cfgMu    sync.RWMutex
	cfg      map[string]string
	defaults map[string]string
)

// SetConfig installs the settings stored in the database (package settings):
// Getenv returns them ahead of the environment, and falls back to defaults.
func SetConfig(values, defs map[string]string) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	cfg, defaults = values, defs
}

// Getenv reads a setting: the database's value, else the environment variable
// (trimming whitespace pasted into secrets), else its default.
func Getenv(key string) string {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	if v := cfg[key]; v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return defaults[key]
}

// DoJSON sends req and decodes a 2xx JSON response into out.
func DoJSON(c *http.Client, req *http.Request, out any) error {
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s %s: %s: %s", req.Method, req.URL.Path, resp.Status, truncate(string(body), 300))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%s %s: decode: %w", req.Method, req.URL.Path, err)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
