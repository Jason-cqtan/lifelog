// Package coros syncs activities from COROS Training Hub (unofficial API, same
// endpoints running_page's coros_sync.py uses).
//
// Env: COROS_ACCOUNT, COROS_PASSWORD; COROS_CN=true for the China server.
package coros

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

type Coros struct{}

func (Coros) Name() string { return "coros" }
func (Coros) Configured() bool {
	return source.Getenv("COROS_ACCOUNT") != "" && source.Getenv("COROS_PASSWORD") != ""
}

func apiBase() string {
	if v := strings.ToLower(source.Getenv("COROS_CN")); v == "true" || v == "1" {
		return "https://teamcnapi.coros.com"
	}
	return "https://teamapi.coros.com"
}

// envelope is COROS's response wrapper; result "0000" means success.
type envelope struct {
	Result  string          `json:"result"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func call(c *http.Client, req *http.Request, out any) error {
	var env envelope
	if err := source.DoJSON(c, req, &env); err != nil {
		return err
	}
	if env.Result != "0000" {
		return fmt.Errorf("coros %s: %s (%s)", req.URL.Path, env.Message, env.Result)
	}
	return json.Unmarshal(env.Data, out)
}

// activity fields as seen in /activity/query; verify against a real account —
// COROS does not document this API.
type activity struct {
	LabelID   string  `json:"labelId"`
	Name      string  `json:"name"`
	SportType int     `json:"sportType"`
	StartTime int64   `json:"startTime"` // unix seconds
	TotalTime float64 `json:"totalTime"` // seconds
	Distance  float64 `json:"distance"`  // meters
	Ascent    float64 `json:"ascent"`
	AvgHr     float64 `json:"avgHr"`
}

func (s Coros) Sync(ctx context.Context, env *source.Env) error {
	sum := md5.Sum([]byte(source.Getenv("COROS_PASSWORD")))
	body, _ := json.Marshal(map[string]any{
		"account":     source.Getenv("COROS_ACCOUNT"),
		"accountType": 2,
		"pwd":         hex.EncodeToString(sum[:]),
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, apiBase()+"/account/login", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	var login struct {
		AccessToken string `json:"accessToken"`
	}
	if err := call(env.HTTP, req, &login); err != nil {
		return err
	}

	var since time.Time
	if !env.Full {
		since = env.Store.LatestActivity(s.Name())
	}
	added := 0
	for page := 1; ; page++ {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/activity/query?size=50&pageNumber=%d", apiBase(), page), nil)
		req.Header.Set("accesstoken", login.AccessToken)
		var res struct {
			TotalPage int        `json:"totalPage"`
			DataList  []activity `json:"dataList"`
		}
		if err := call(env.HTTP, req, &res); err != nil {
			return err
		}
		reachedKnown := false
		for _, a := range res.DataList {
			st := time.Unix(a.StartTime, 0).UTC()
			if !since.IsZero() && !st.After(since) {
				reachedKnown = true
				continue
			}
			if env.Store.UpsertActivity(model.Activity{
				Source:        s.Name(),
				SourceID:      a.LabelID,
				Type:          sportType(a.SportType),
				RawType:       fmt.Sprint(a.SportType),
				Name:          a.Name,
				StartTime:     st,
				Distance:      a.Distance,
				MovingTime:    int(a.TotalTime),
				ElevationGain: a.Ascent,
				AvgHeartRate:  a.AvgHr,
			}) {
				added++
			}
		}
		if reachedKnown || page >= res.TotalPage || len(res.DataList) == 0 {
			break
		}
	}
	env.Log.Printf("coros: %d new activities", added)
	return nil
}

// sportType maps COROS sport codes: 1xx run/hike, 2xx bike, 3xx swim, 9xx walk.
func sportType(code int) model.SportType {
	switch {
	case code == 104 || code == 105: // hike, mountain climb
		return model.Hike
	case code >= 100 && code < 200:
		return model.Run
	case code >= 200 && code < 300:
		return model.Ride
	case code >= 300 && code < 400:
		return model.Swim
	case code >= 900 && code < 1000:
		return model.Walk
	}
	return model.Workout
}
