// Package github syncs the daily contribution calendar (commits, PRs, issues,
// reviews) via the GraphQL API.
//
// Env: GH_USERNAME, GH_TOKEN (a PAT with read:user; also counts private
// contributions if "Include private contributions" is on in your profile).
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/yourname/lifelog/internal/model"
	"github.com/yourname/lifelog/internal/source"
)

type GitHub struct{}

func (GitHub) Name() string { return "github" }
func (GitHub) Configured() bool {
	return source.Getenv("GH_USERNAME") != "" && source.Getenv("GH_TOKEN") != ""
}

const calendarQuery = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
}`

type calendarResp struct {
	Data struct {
		User struct {
			CreatedAt               time.Time `json:"createdAt"`
			ContributionsCollection struct {
				ContributionCalendar struct {
					Weeks []struct {
						ContributionDays []struct {
							Date              string `json:"date"`
							ContributionCount int    `json:"contributionCount"`
						} `json:"contributionDays"`
					} `json:"weeks"`
				} `json:"contributionCalendar"`
			} `json:"contributionsCollection"`
		} `json:"user"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func (g GitHub) query(ctx context.Context, env *source.Env, from, to time.Time) (*calendarResp, error) {
	body, _ := json.Marshal(map[string]any{
		"query": calendarQuery,
		"variables": map[string]string{
			"login": source.Getenv("GH_USERNAME"),
			"from":  from.UTC().Format(time.RFC3339),
			"to":    to.UTC().Format(time.RFC3339),
		},
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.github.com/graphql", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+source.Getenv("GH_TOKEN"))
	req.Header.Set("Content-Type", "application/json")
	var res calendarResp
	if err := source.DoJSON(env.HTTP, req, &res); err != nil {
		return nil, err
	}
	if len(res.Errors) > 0 {
		return nil, fmt.Errorf("github graphql: %s", res.Errors[0].Message)
	}
	return &res, nil
}

func (g GitHub) Sync(ctx context.Context, env *source.Env) error {
	now := time.Now().In(env.Loc)
	from := now.AddDate(0, 0, -30)
	if env.Full {
		// One query first just to learn when the account was created.
		res, err := g.query(ctx, env, now.AddDate(0, 0, -1), now)
		if err != nil {
			return err
		}
		from = res.Data.User.CreatedAt
	}
	days := 0
	// contributionsCollection spans at most one year per query.
	for start := from; start.Before(now); start = start.AddDate(1, 0, 0) {
		end := start.AddDate(1, 0, 0).Add(-time.Second)
		if end.After(now) {
			end = now
		}
		res, err := g.query(ctx, env, start, end)
		if err != nil {
			return err
		}
		for _, w := range res.Data.User.ContributionsCollection.ContributionCalendar.Weeks {
			for _, d := range w.ContributionDays {
				if d.ContributionCount == 0 {
					continue
				}
				env.Store.PutDaily(model.DailyMetric{Date: d.Date, Source: g.Name(), Metric: "contributions", Value: float64(d.ContributionCount)})
				days++
			}
		}
	}
	env.Log.Printf("github: %d active days updated", days)
	return nil
}
