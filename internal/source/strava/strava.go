// Package strava syncs activities via the official Strava API v3.
//
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
// (get the refresh token once with `lifelog auth strava`).
package strava

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/yourname/lifelog/internal/model"
	"github.com/yourname/lifelog/internal/oauth"
	"github.com/yourname/lifelog/internal/source"
)

const tokenURL = "https://www.strava.com/oauth/token"

type Strava struct{}

func (Strava) Name() string { return "strava" }

func (Strava) Configured() bool {
	return source.Getenv("STRAVA_CLIENT_ID") != "" && source.Getenv("STRAVA_REFRESH_TOKEN") != ""
}

type activity struct {
	ID                 int64     `json:"id"`
	Name               string    `json:"name"`
	SportType          string    `json:"sport_type"`
	StartDate          time.Time `json:"start_date"`
	Distance           float64   `json:"distance"`
	MovingTime         int       `json:"moving_time"`
	ElapsedTime        int       `json:"elapsed_time"`
	TotalElevationGain float64   `json:"total_elevation_gain"`
	AverageHeartrate   float64   `json:"average_heartrate"`
	Map                struct {
		SummaryPolyline string `json:"summary_polyline"`
	} `json:"map"`
}

func (s Strava) Sync(ctx context.Context, env *source.Env) error {
	tok, err := oauth.PostToken(ctx, env.HTTP, tokenURL, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {source.Getenv("STRAVA_REFRESH_TOKEN")},
	}, source.Getenv("STRAVA_CLIENT_ID"), source.Getenv("STRAVA_CLIENT_SECRET"), false)
	if err != nil {
		return fmt.Errorf("refresh token: %w", err)
	}

	var after int64
	if !env.Full {
		after = env.Store.LatestActivity(s.Name()).Unix()
	}
	added := 0
	for page := 1; ; page++ {
		q := url.Values{"per_page": {"200"}, "page": {strconv.Itoa(page)}}
		if after > 0 {
			q.Set("after", strconv.FormatInt(after, 10))
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			"https://www.strava.com/api/v3/athlete/activities?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		var list []activity
		if err := source.DoJSON(env.HTTP, req, &list); err != nil {
			return err
		}
		for _, a := range list {
			if env.Store.UpsertActivity(model.Activity{
				Source:        s.Name(),
				SourceID:      strconv.FormatInt(a.ID, 10),
				Type:          model.NormalizeType(a.SportType),
				RawType:       a.SportType,
				Name:          a.Name,
				StartTime:     a.StartDate.UTC(),
				Distance:      a.Distance,
				MovingTime:    a.MovingTime,
				ElapsedTime:   a.ElapsedTime,
				ElevationGain: a.TotalElevationGain,
				AvgHeartRate:  a.AverageHeartrate,
				Polyline:      a.Map.SummaryPolyline,
			}) {
				added++
			}
		}
		if len(list) < 200 {
			break
		}
	}
	env.Log.Printf("strava: %d new activities", added)
	return nil
}

// Authorize runs the one-time OAuth flow and prints the refresh token.
// The Strava app's "Authorization Callback Domain" must be 127.0.0.1.
func Authorize(ctx context.Context, c *http.Client) error {
	clientID, secret := source.Getenv("STRAVA_CLIENT_ID"), source.Getenv("STRAVA_CLIENT_SECRET")
	if clientID == "" || secret == "" {
		return fmt.Errorf("set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET first (https://www.strava.com/settings/api)")
	}
	authURL := "https://www.strava.com/oauth/authorize?" + url.Values{
		"client_id":       {clientID},
		"response_type":   {"code"},
		"redirect_uri":    {oauth.RedirectURI},
		"approval_prompt": {"force"},
		"scope":           {"read,activity:read_all"},
	}.Encode()
	code, err := oauth.WaitForCode(ctx, authURL)
	if err != nil {
		return err
	}
	tok, err := oauth.PostToken(ctx, c, tokenURL, url.Values{
		"grant_type": {"authorization_code"},
		"code":       {code},
	}, clientID, secret, false)
	if err != nil {
		return err
	}
	fmt.Println("STRAVA_REFRESH_TOKEN=" + tok.RefreshToken)
	return nil
}
