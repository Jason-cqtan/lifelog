// Package duolingo syncs daily XP and study time from Duolingo's (unofficial)
// xp_summaries endpoint, which the web app uses for its streak calendar.
//
// Env: DUOLINGO_JWT — the value of the `jwt_token` cookie after logging in at
// duolingo.com (DevTools -> Application -> Cookies).
package duolingo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

type Duolingo struct{}

func (Duolingo) Name() string     { return "duolingo" }
func (Duolingo) Configured() bool { return source.Getenv("DUOLINGO_JWT") != "" }

type summary struct {
	Date             int64 `json:"date"` // unix seconds, start of the day
	GainedXp         int   `json:"gainedXp"`
	NumSessions      int   `json:"numSessions"`
	TotalSessionTime int   `json:"totalSessionTime"` // seconds
}

func (d Duolingo) Sync(ctx context.Context, env *source.Env) error {
	jwt := source.Getenv("DUOLINGO_JWT")
	userID, err := userIDFromJWT(jwt)
	if err != nil {
		return err
	}

	end := time.Now().In(env.Loc)
	start := end.AddDate(0, 0, -14) // re-fetch recent days: today's numbers keep growing
	if env.Full {
		start = end.AddDate(-6, 0, 0)
	}
	days := 0
	// Fetch in 90-day windows to keep responses small.
	for from := start; from.Before(end); from = from.AddDate(0, 0, 90) {
		to := from.AddDate(0, 0, 89)
		if to.After(end) {
			to = end
		}
		summaries, err := fetch(ctx, env.HTTP, jwt, userID, from, to, env.Loc)
		if err != nil {
			return err
		}
		for _, s := range summaries {
			if s.GainedXp == 0 && s.TotalSessionTime == 0 {
				continue
			}
			date := store.DateIn(time.Unix(s.Date, 0), env.Loc)
			put := func(metric string, v float64) {
				env.Store.PutDaily(model.DailyMetric{Date: date, Source: d.Name(), Metric: metric, Value: v})
			}
			put("minutes", float64(s.TotalSessionTime)/60)
			put("xp", float64(s.GainedXp))
			put("sessions", float64(s.NumSessions))
			days++
		}
	}
	env.Log.Printf("duolingo: %d active days updated", days)
	return nil
}

func fetch(ctx context.Context, c *http.Client, jwt, userID string, from, to time.Time, loc *time.Location) ([]summary, error) {
	q := url.Values{
		"startDate": {from.Format("2006-01-02")},
		"endDate":   {to.Format("2006-01-02")},
		"timezone":  {loc.String()},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("https://www.duolingo.com/2017-06-30/users/%s/xp_summaries?%s", userID, q.Encode()), nil)
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	var res struct {
		Summaries []summary `json:"summaries"`
	}
	if err := source.DoJSON(c, req, &res); err != nil {
		return nil, err
	}
	return res.Summaries, nil
}

// Check makes one real request with the token and returns its expiry (zero if
// the token has none), so `lifelog auth duolingo` can reject a bad paste.
func Check(ctx context.Context, c *http.Client, jwt string) (time.Time, error) {
	userID, err := userIDFromJWT(jwt)
	if err != nil {
		return time.Time{}, err
	}
	now := time.Now()
	if _, err := fetch(ctx, c, jwt, userID, now.AddDate(0, 0, -1), now, time.UTC); err != nil {
		return time.Time{}, err
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	payload, _ := base64.RawURLEncoding.DecodeString(strings.Split(jwt, ".")[1])
	json.Unmarshal(payload, &claims)
	if claims.Exp == 0 {
		return time.Time{}, nil
	}
	return time.Unix(claims.Exp, 0), nil
}

// userIDFromJWT reads the numeric user id from the token's "sub" claim.
func userIDFromJWT(jwt string) (string, error) {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("DUOLINGO_JWT does not look like a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode DUOLINGO_JWT: %w", err)
	}
	var claims struct {
		Sub json.Number `json:"sub"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Sub == "" {
		return "", fmt.Errorf("DUOLINGO_JWT has no sub claim")
	}
	return claims.Sub.String(), nil
}
