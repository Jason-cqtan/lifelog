package trakt

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

const history = `[
 {"id": 11, "watched_at": "2026-10-20T13:50:00.000Z", "action": "scrobble", "type": "episode",
  "episode": {"season": 1, "number": 2, "title": "The Weirdo on Maple Street", "runtime": 55},
  "show": {"title": "Stranger Things", "runtime": 50}},
 {"id": 12, "watched_at": "2026-10-21T15:00:00.000Z", "action": "watch", "type": "episode",
  "episode": {"season": 1, "number": 3, "title": "", "runtime": 0},
  "show": {"title": "Stranger Things", "runtime": 50}},
 {"id": 13, "watched_at": "2026-10-22T14:30:00.000Z", "action": "checkin", "type": "movie",
  "movie": {"title": "Glass Onion", "year": 2022, "runtime": 140}}
]`

func TestSync(t *testing.T) {
	var gotStart, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("trakt-api-key") != "cid" || r.Header.Get("trakt-api-version") != "2" {
			http.Error(w, "missing headers", http.StatusBadRequest)
			return
		}
		switch r.URL.Path {
		case "/oauth/token":
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			if body["grant_type"] != "refresh_token" || body["refresh_token"] != "old" || body["client_secret"] != "sec" {
				http.Error(w, "bad grant", http.StatusUnauthorized)
				return
			}
			io.WriteString(w, `{"access_token": "acc", "refresh_token": "new", "expires_in": 86400}`)
		case "/sync/history":
			gotAuth, gotStart = r.Header.Get("Authorization"), r.URL.Query().Get("start_at")
			io.WriteString(w, history)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	API = srv.URL

	saved := map[string]string{}
	source.SetConfig(map[string]string{"TRAKT_CLIENT_ID": "cid", "TRAKT_CLIENT_SECRET": "sec", "TRAKT_REFRESH_TOKEN": "old"}, nil)
	source.SetSaver(func(k, v string) error { saved[k] = v; return nil })
	defer source.SetSaver(nil)

	st, _ := store.Open(t.TempDir(), "")
	env := &source.Env{Store: st, HTTP: srv.Client(), Loc: time.UTC, Log: log.New(io.Discard, "", 0)}
	if err := (Trakt{}).Sync(context.Background(), env); err != nil {
		t.Fatal(err)
	}
	if saved["TRAKT_REFRESH_TOKEN"] != "new" || source.Getenv("TRAKT_REFRESH_TOKEN") != "new" {
		t.Errorf("rotated refresh token not saved: %v", saved)
	}
	if gotAuth != "Bearer acc" || gotStart != "" {
		t.Errorf("first sync: auth %q, start_at %q (want full history)", gotAuth, gotStart)
	}
	ws := st.Watches()
	if len(ws) != 3 {
		t.Fatalf("got %d watches", len(ws))
	}
	if w := ws[0]; w.Title != "Stranger Things" || w.Episode != "S01E02 The Weirdo on Maple Street" || w.Seconds != 55*60 || w.Kind != "episode" {
		t.Errorf("episode = %+v", w)
	}
	if w := ws[1]; w.Episode != "S01E03" || w.Seconds != 50*60 {
		t.Errorf("episode without its own runtime = %+v, want the show's", w)
	}
	if w := ws[2]; w.Title != "Glass Onion" || w.Kind != "movie" || w.Seconds != 140*60 || w.Key() != "trakt:13" {
		t.Errorf("movie = %+v", w)
	}

	// the next sync only asks for recent history, with a lookback
	source.SetConfig(map[string]string{"TRAKT_CLIENT_ID": "cid", "TRAKT_CLIENT_SECRET": "sec", "TRAKT_REFRESH_TOKEN": "old"}, nil)
	if err := (Trakt{}).Sync(context.Background(), env); err != nil {
		t.Fatal(err)
	}
	if want := "2026-09-22T14:30:00Z"; gotStart != want {
		t.Errorf("incremental start_at = %q, want %q", gotStart, want)
	}
}

func TestSyncFailsWhenTokenCannotBeSaved(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/oauth/token") {
			io.WriteString(w, `{"access_token": "acc", "refresh_token": "new"}`)
			return
		}
		io.WriteString(w, "[]")
	}))
	defer srv.Close()
	API = srv.URL
	source.SetConfig(map[string]string{"TRAKT_CLIENT_ID": "cid", "TRAKT_REFRESH_TOKEN": "old"}, nil)
	source.SetSaver(nil)
	st, _ := store.Open(t.TempDir(), "")
	env := &source.Env{Store: st, HTTP: srv.Client(), Loc: time.UTC, Log: log.New(io.Discard, "", 0)}
	if err := (Trakt{}).Sync(context.Background(), env); err == nil || !strings.Contains(err.Error(), "lifelog auth trakt") {
		t.Fatalf("err = %v, want a hint to re-authorize", err)
	}
}
