// Package trakt syncs watch history from Trakt (trakt.tv), the one way to get
// Netflix viewing automatically: Netflix has no API, but the browser extension
// Universal Trakt Scrobbler records what you watch on Netflix (and other
// services) into Trakt.
//
// Trakt rotates refresh tokens: every refresh returns a new one and the old one
// stops working, so each sync saves the new token right away (source.SaveSetting).
// That needs the database or a .env that persists between runs; the GitHub
// Actions sync cannot keep it.
//
// Env: TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET, TRAKT_REFRESH_TOKEN
// (get the refresh token once with `lifelog auth trakt`).
package trakt

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/oauth"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

// API and Site are variables so tests can point them at a fake server.
var (
	API  = "https://api.trakt.tv"
	Site = "https://trakt.tv"
)

const (
	pageSize = 100
	// Lookback re-reads this much history before the newest stored watch on an
	// incremental sync: scrobbler extensions add past Netflix views late, with
	// their original dates.
	Lookback = 30 * 24 * time.Hour
)

type Trakt struct{}

func (Trakt) Name() string { return "trakt" }
func (Trakt) Configured() bool {
	return source.Getenv("TRAKT_CLIENT_ID") != "" && source.Getenv("TRAKT_REFRESH_TOKEN") != ""
}

func (Trakt) Sync(ctx context.Context, env *source.Env) error {
	id, secret := source.Getenv("TRAKT_CLIENT_ID"), source.Getenv("TRAKT_CLIENT_SECRET")
	tok, err := token(ctx, env.HTTP, map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": source.Getenv("TRAKT_REFRESH_TOKEN"),
	}, id, secret)
	if err != nil {
		return fmt.Errorf("refresh token (re-run `lifelog auth trakt` if it expired): %w", err)
	}
	if tok.RefreshToken != "" && tok.RefreshToken != source.Getenv("TRAKT_REFRESH_TOKEN") {
		if err := source.SaveSetting("TRAKT_REFRESH_TOKEN", tok.RefreshToken); err != nil {
			// the old token is already spent: without this one the next sync fails
			return fmt.Errorf("save the new refresh token (re-run `lifelog auth trakt`): %w", err)
		}
	}

	q := url.Values{"extended": {"full"}, "limit": {strconv.Itoa(pageSize)}}
	if latest := env.Store.LatestWatch("trakt"); !env.Full && !latest.IsZero() {
		q.Set("start_at", latest.Add(-Lookback).UTC().Format(time.RFC3339))
	}
	added, seen := 0, 0
	for page := 1; ; page++ {
		q.Set("page", strconv.Itoa(page))
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, API+"/sync/history?"+q.Encode(), nil)
		setHeaders(req, id)
		req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		var items []historyItem
		if err := source.DoJSON(env.HTTP, req, &items); err != nil {
			return err
		}
		for _, it := range items {
			w, ok := it.watch()
			if !ok {
				continue
			}
			seen++
			if env.Store.PutWatch(w) {
				added++
			}
		}
		if len(items) < pageSize {
			break
		}
	}
	env.Log.Printf("trakt: %d history entries read, %d new", seen, added)
	return nil
}

type ids struct {
	Trakt int64 `json:"trakt"`
}

type historyItem struct {
	ID        int64     `json:"id"`
	WatchedAt time.Time `json:"watched_at"`
	Type      string    `json:"type"`
	Movie     *struct {
		Title   string `json:"title"`
		Year    int    `json:"year"`
		Runtime int    `json:"runtime"`
	} `json:"movie"`
	Episode *struct {
		Season  int    `json:"season"`
		Number  int    `json:"number"`
		Title   string `json:"title"`
		Runtime int    `json:"runtime"`
	} `json:"episode"`
	Show *struct {
		Title   string `json:"title"`
		Runtime int    `json:"runtime"`
	} `json:"show"`
}

// watch turns a history entry into a Watch. Trakt does not say how long you
// watched, so the runtime (minutes) stands in for it.
func (it historyItem) watch() (model.Watch, bool) {
	w := model.Watch{Source: "trakt", SourceID: strconv.FormatInt(it.ID, 10), WatchedAt: it.WatchedAt.UTC(), Kind: it.Type}
	switch {
	case it.Type == "movie" && it.Movie != nil:
		w.Title, w.Seconds = it.Movie.Title, it.Movie.Runtime*60
	case it.Type == "episode" && it.Episode != nil && it.Show != nil:
		w.Title = it.Show.Title
		w.Episode = fmt.Sprintf("S%02dE%02d", it.Episode.Season, it.Episode.Number)
		if it.Episode.Title != "" {
			w.Episode += " " + it.Episode.Title
		}
		rt := it.Episode.Runtime
		if rt == 0 {
			rt = it.Show.Runtime
		}
		w.Seconds = rt * 60
	default:
		return w, false
	}
	return w, it.ID != 0 && w.Title != ""
}

func setHeaders(req *http.Request, clientID string) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("trakt-api-version", "2")
	req.Header.Set("trakt-api-key", clientID)
	req.Header.Set("User-Agent", "lifelog/1.0") // Trakt rejects requests without one
}

// token posts to Trakt's token endpoint, which takes JSON rather than a form.
func token(ctx context.Context, c *http.Client, body map[string]string, clientID, secret string) (*oauth.TokenResponse, error) {
	body["client_id"], body["client_secret"], body["redirect_uri"] = clientID, secret, oauth.RedirectURI
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, API+"/oauth/token", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	setHeaders(req, clientID)
	var tok oauth.TokenResponse
	if err := source.DoJSON(c, req, &tok); err != nil {
		return nil, err
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("no access token in response")
	}
	return &tok, nil
}

// Authorize runs the one-time OAuth flow and returns the refresh token. Create
// the app at trakt.tv/oauth/applications with redirect URI oauth.RedirectURI.
func Authorize(ctx context.Context, c *http.Client, clientID, secret string) (string, error) {
	authURL := Site + "/oauth/authorize?" + url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {oauth.RedirectURI},
	}.Encode()
	code, err := oauth.WaitForCode(ctx, authURL)
	if err != nil {
		return "", err
	}
	tok, err := token(ctx, c, map[string]string{"grant_type": "authorization_code", "code": code}, clientID, secret)
	if err != nil {
		return "", err
	}
	return tok.RefreshToken, nil
}
