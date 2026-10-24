// Package spotify records listening history.
//
// The Web API only returns the last 50 played tracks, so the scheduled sync must
// run more often than 50 songs (~2.5 h); the workflow runs every 2 hours. For the
// past, request "Extended streaming history" in Spotify's privacy settings and run
// `lifelog import spotify-history Streaming_History_Audio_*.json`.
//
// Env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN
// (get the refresh token once with `lifelog auth spotify`).
package spotify

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/oauth"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

const tokenURL = "https://accounts.spotify.com/api/token"

type Spotify struct{}

func (Spotify) Name() string { return "spotify" }
func (Spotify) Configured() bool {
	return source.Getenv("SPOTIFY_CLIENT_ID") != "" && source.Getenv("SPOTIFY_REFRESH_TOKEN") != ""
}

func (s Spotify) Sync(ctx context.Context, env *source.Env) error {
	tok, err := oauth.PostToken(ctx, env.HTTP, tokenURL, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {source.Getenv("SPOTIFY_REFRESH_TOKEN")},
	}, source.Getenv("SPOTIFY_CLIENT_ID"), source.Getenv("SPOTIFY_CLIENT_SECRET"), true)
	if err != nil {
		return fmt.Errorf("refresh token: %w", err)
	}

	after := env.Store.LatestPlay()
	added := 0
	for {
		q := url.Values{"limit": {"50"}}
		if !after.IsZero() {
			q.Set("after", strconv.FormatInt(after.UnixMilli(), 10))
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			"https://api.spotify.com/v1/me/player/recently-played?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		var res struct {
			Items []struct {
				PlayedAt time.Time `json:"played_at"`
				Track    struct {
					ID         string `json:"id"`
					Name       string `json:"name"`
					DurationMs int64  `json:"duration_ms"`
					Artists    []struct {
						Name string `json:"name"`
					} `json:"artists"`
				} `json:"track"`
			} `json:"items"`
		}
		if err := source.DoJSON(env.HTTP, req, &res); err != nil {
			return err
		}
		prev := after
		for _, it := range res.Items {
			var artists []string
			for _, a := range it.Track.Artists {
				artists = append(artists, a.Name)
			}
			// The API does not say how much was actually heard; assume the full track.
			if env.Store.AddPlay(model.Play{
				PlayedAt: it.PlayedAt.UTC(),
				Track:    it.Track.Name,
				Artist:   strings.Join(artists, ", "),
				TrackID:  it.Track.ID,
				MsPlayed: it.Track.DurationMs,
			}) {
				added++
			}
			if it.PlayedAt.After(after) {
				after = it.PlayedAt
			}
		}
		if len(res.Items) < 50 || !after.After(prev) {
			break
		}
	}
	env.Log.Printf("spotify: %d new plays", added)
	return nil
}

// ImportHistory reads a Spotify data-export file. It accepts both the
// "Extended streaming history" format (ts, ms_played, master_metadata_*) and the
// basic "Account data" format (endTime, msPlayed, trackName).
func ImportHistory(r io.Reader, st *store.Store) (int, error) {
	var rows []struct {
		Ts          string `json:"ts"`
		MsPlayedExt int64  `json:"ms_played"`
		TrackExt    string `json:"master_metadata_track_name"`
		ArtistExt   string `json:"master_metadata_album_artist_name"`
		URI         string `json:"spotify_track_uri"`
		Episode     string `json:"episode_name"`

		EndTime  string `json:"endTime"`
		MsPlayed int64  `json:"msPlayed"`
		Track    string `json:"trackName"`
		Artist   string `json:"artistName"`
	}
	if err := json.NewDecoder(r).Decode(&rows); err != nil {
		return 0, err
	}
	added := 0
	for _, row := range rows {
		var p model.Play
		if row.Ts != "" {
			t, err := time.Parse(time.RFC3339, row.Ts)
			if err != nil {
				continue
			}
			track := row.TrackExt
			if track == "" {
				track = row.Episode
			}
			p = model.Play{PlayedAt: t.UTC(), Track: track, Artist: row.ArtistExt,
				TrackID: strings.TrimPrefix(row.URI, "spotify:track:"), MsPlayed: row.MsPlayedExt}
		} else {
			t, err := time.Parse("2006-01-02 15:04", row.EndTime) // UTC per Spotify docs
			if err != nil {
				continue
			}
			p = model.Play{PlayedAt: t, Track: row.Track, Artist: row.Artist, MsPlayed: row.MsPlayed}
		}
		if p.MsPlayed <= 0 || p.Track == "" {
			continue
		}
		if st.AddPlay(p) {
			added++
		}
	}
	return added, nil
}

// Authorize runs the one-time OAuth flow and returns the refresh token. Add
// http://127.0.0.1:8888/callback as a Redirect URI in the Spotify app dashboard.
func Authorize(ctx context.Context, c *http.Client, clientID, secret string) (string, error) {
	authURL := "https://accounts.spotify.com/authorize?" + url.Values{
		"client_id":     {clientID},
		"response_type": {"code"},
		"redirect_uri":  {oauth.RedirectURI},
		"scope":         {"user-read-recently-played"},
	}.Encode()
	code, err := oauth.WaitForCode(ctx, authURL)
	if err != nil {
		return "", err
	}
	tok, err := oauth.PostToken(ctx, c, tokenURL, url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {oauth.RedirectURI},
	}, clientID, secret, true)
	if err != nil {
		return "", err
	}
	return tok.RefreshToken, nil
}
