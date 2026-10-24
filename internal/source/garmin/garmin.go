// Package garmin syncs activities from Garmin Connect (global or China region).
//
// Garmin has no public API for individuals, so this follows the same mobile-app
// SSO flow as the Python `garth` library that running_page uses:
// SSO login -> ticket -> OAuth1 token (valid ~1 year) -> short-lived OAuth2 token.
//
// Run `lifelog auth garmin` once locally (handles MFA) and store the printed
// string as GARMIN_TOKEN; each sync only exchanges it for a fresh OAuth2 token,
// so CI never needs your password. Set GARMIN_CN=true for garmin.cn accounts.
package garmin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/effort"
	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/polyline"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

const (
	ssoUserAgent = "com.garmin.android.apps.connectmobile"
	apiUserAgent = "GCM-iOS-5.7.2.1"
	consumerURL  = "https://thegarth.s3.amazonaws.com/oauth_consumer.json"
)

// Token is what GARMIN_TOKEN holds (base64 JSON).
type Token struct {
	Domain     string `json:"domain"`
	OAuthToken string `json:"oauth_token"`
	Secret     string `json:"oauth_token_secret"`
	MFAToken   string `json:"mfa_token,omitempty"`
}

func (t Token) Encode() string {
	b, _ := json.Marshal(t)
	return base64.StdEncoding.EncodeToString(b)
}

func DecodeToken(s string) (Token, error) {
	var t Token
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return t, fmt.Errorf("GARMIN_TOKEN is not valid base64: %w", err)
	}
	return t, json.Unmarshal(b, &t)
}

func Domain() string {
	if v := strings.ToLower(source.Getenv("GARMIN_CN")); v == "true" || v == "1" {
		return "garmin.cn"
	}
	return "garmin.com"
}

type Garmin struct{}

func (Garmin) Name() string     { return "garmin" }
func (Garmin) Configured() bool { return source.Getenv("GARMIN_TOKEN") != "" }

type consumer struct {
	Key    string `json:"consumer_key"`
	Secret string `json:"consumer_secret"`
}

func fetchConsumer(ctx context.Context, c *http.Client) (consumer, error) {
	var cs consumer
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, consumerURL, nil)
	err := source.DoJSON(c, req, &cs)
	return cs, err
}

// Login performs the SSO flow with email + password and returns a long-lived token.
// mfa is called only if the account has two-factor auth enabled.
func Login(ctx context.Context, email, password, domain string, mfa func() (string, error)) (Token, error) {
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, Timeout: 30 * time.Second}

	sso := "https://sso." + domain + "/sso"
	embed := sso + "/embed"
	embedParams := url.Values{"id": {"gauth-widget"}, "embedWidget": {"true"}, "gauthHost": {sso}}
	signinParams := url.Values{
		"id": {"gauth-widget"}, "embedWidget": {"true"}, "gauthHost": {embed},
		"service": {embed}, "source": {embed},
		"redirectAfterAccountLoginUrl": {embed}, "redirectAfterAccountCreationUrl": {embed},
	}
	signinURL := sso + "/signin?" + signinParams.Encode()

	page := func(method, u, referer string, form url.Values) (string, error) {
		var body io.Reader
		if form != nil {
			body = strings.NewReader(form.Encode())
		}
		req, _ := http.NewRequestWithContext(ctx, method, u, body)
		req.Header.Set("User-Agent", apiUserAgent)
		if referer != "" {
			req.Header.Set("Referer", referer)
		}
		if form != nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		resp, err := c.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if resp.StatusCode/100 != 2 {
			return "", fmt.Errorf("garmin sso %s: %s", req.URL.Path, resp.Status)
		}
		return string(b), err
	}

	if _, err := page(http.MethodGet, embed+"?"+embedParams.Encode(), "", nil); err != nil {
		return Token{}, err
	}
	html, err := page(http.MethodGet, signinURL, embed, nil)
	if err != nil {
		return Token{}, err
	}
	html, err = page(http.MethodPost, signinURL, signinURL, url.Values{
		"username": {email}, "password": {password}, "embed": {"true"}, "_csrf": {match(csrfRe, html)},
	})
	if err != nil {
		return Token{}, err
	}
	if strings.Contains(match(titleRe, html), "MFA") {
		code, err := mfa()
		if err != nil {
			return Token{}, err
		}
		html, err = page(http.MethodPost, sso+"/verifyMFA/loginEnterMfaCode?"+signinParams.Encode(), signinURL, url.Values{
			"mfa-code": {code}, "embed": {"true"}, "_csrf": {match(csrfRe, html)}, "fromPage": {"setupEnterMfaCode"},
		})
		if err != nil {
			return Token{}, err
		}
	}
	if t := match(titleRe, html); t != "Success" {
		return Token{}, fmt.Errorf("garmin login failed (page title %q) — check email/password", t)
	}
	ticket := match(ticketRe, html)
	if ticket == "" {
		return Token{}, fmt.Errorf("garmin login: no ticket in response")
	}

	cs, err := fetchConsumer(ctx, c)
	if err != nil {
		return Token{}, err
	}
	base := "https://connectapi." + domain + "/oauth-service/oauth/preauthorized"
	q := url.Values{"ticket": {ticket}, "login-url": {embed}, "accepts-mfa-tokens": {"true"}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	req.Header.Set("User-Agent", ssoUserAgent)
	req.Header.Set("Authorization", oauth1Header(http.MethodGet, base, q, cs.Key, cs.Secret, "", ""))
	resp, err := c.Do(req)
	if err != nil {
		return Token{}, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return Token{}, fmt.Errorf("garmin oauth1: %s: %s", resp.Status, b)
	}
	vals, err := url.ParseQuery(string(b))
	if err != nil {
		return Token{}, err
	}
	return Token{
		Domain:     domain,
		OAuthToken: vals.Get("oauth_token"),
		Secret:     vals.Get("oauth_token_secret"),
		MFAToken:   vals.Get("mfa_token"),
	}, nil
}

var (
	csrfRe   = regexp.MustCompile(`name="_csrf"\s+value="(.+?)"`)
	titleRe  = regexp.MustCompile(`<title>(.+?)</title>`)
	ticketRe = regexp.MustCompile(`embed\?ticket=([^"]+)"`)
)

func match(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

// accessToken exchanges the long-lived OAuth1 token for an OAuth2 bearer token.
func accessToken(ctx context.Context, c *http.Client, t Token) (string, error) {
	cs, err := fetchConsumer(ctx, c)
	if err != nil {
		return "", err
	}
	u := "https://connectapi." + t.Domain + "/oauth-service/oauth/exchange/user/2.0"
	form := url.Values{}
	if t.MFAToken != "" {
		form.Set("mfa_token", t.MFAToken)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	req.Header.Set("User-Agent", ssoUserAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", oauth1Header(http.MethodPost, u, form, cs.Key, cs.Secret, t.OAuthToken, t.Secret))
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := source.DoJSON(c, req, &out); err != nil {
		return "", fmt.Errorf("garmin oauth2 exchange (re-run `lifelog auth garmin` if the token expired): %w", err)
	}
	return out.AccessToken, nil
}

type activity struct {
	ActivityID   int64   `json:"activityId"`
	ActivityName string  `json:"activityName"`
	StartTimeGMT string  `json:"startTimeGMT"` // "2006-01-02 15:04:05"
	Distance     float64 `json:"distance"`
	Duration     float64 `json:"duration"`
	Moving       float64 `json:"movingDuration"`
	Elapsed      float64 `json:"elapsedDuration"`
	ElevGain     float64 `json:"elevationGain"`
	AvgHR        float64 `json:"averageHR"`
	HasPolyline  bool    `json:"hasPolyline"`
	ActivityType struct {
		TypeKey string `json:"typeKey"`
	} `json:"activityType"`
}

func (g Garmin) Sync(ctx context.Context, env *source.Env) error {
	tok, err := DecodeToken(source.Getenv("GARMIN_TOKEN"))
	if err != nil {
		return err
	}
	if tok.Domain == "" {
		tok.Domain = Domain()
	}
	bearer, err := accessToken(ctx, env.HTTP, tok)
	if err != nil {
		return err
	}

	var since time.Time
	if !env.Full {
		since = env.Store.LatestActivity(g.Name())
	}
	api := func(path string, out any) error {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://connectapi."+tok.Domain+path, nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("User-Agent", apiUserAgent)
		return source.DoJSON(env.HTTP, req, out)
	}

	const limit = 100
	added, routes, weathers, efforts, detailErrs := 0, 0, 0, 0, 0
	for start := 0; ; start += limit {
		var list []activity
		if err := api(fmt.Sprintf("/activitylist-service/activities/search/activities?start=%d&limit=%d", start, limit), &list); err != nil {
			return err
		}
		reachedKnown := false
		for _, a := range list {
			st, err := time.ParseInLocation("2006-01-02 15:04:05", a.StartTimeGMT, time.UTC)
			if err != nil {
				continue
			}
			if !since.IsZero() && !st.After(since) {
				reachedKnown = true // list is newest-first
				continue
			}
			moving := a.Moving
			if moving == 0 {
				moving = a.Duration
			}
			act := model.Activity{
				Source:        g.Name(),
				SourceID:      strconv.FormatInt(a.ActivityID, 10),
				Type:          model.NormalizeType(a.ActivityType.TypeKey),
				RawType:       a.ActivityType.TypeKey,
				Name:          a.ActivityName,
				StartTime:     st,
				Distance:      a.Distance,
				MovingTime:    int(moving),
				ElapsedTime:   int(a.Elapsed),
				ElevationGain: a.ElevGain,
				AvgHeartRate:  a.AvgHR,
			}
			// The list has no track or weather; fetch them once per activity (indoor
			// ones have neither: weather is looked up from the activity's location),
			// keeping what we already have so -full does not re-download everything.
			if prev, ok := env.Store.Activity(act.Key()); ok {
				act.Polyline = prev.Polyline
				act.Weather = prev.Weather
				act.BestEfforts = prev.BestEfforts
			}
			fetched := false
			if act.Polyline == "" && a.HasPolyline {
				if act.Polyline, err = fetchRoute(api, a.ActivityID); err != nil {
					env.Log.Printf("garmin: route for %d: %v", a.ActivityID, err)
					detailErrs++
				} else {
					routes++
				}
				fetched = true
			}
			if act.Weather == nil && a.HasPolyline {
				if act.Weather, err = fetchWeather(api, a.ActivityID); err != nil {
					env.Log.Printf("garmin: weather for %d: %v", a.ActivityID, err)
					detailErrs++
				} else if act.Weather != nil {
					weathers++
				}
				fetched = true
			}
			if act.BestEfforts == nil && act.Type == model.Run && act.Distance >= 1000 {
				if act.BestEfforts, err = fetchEfforts(api, a.ActivityID); err != nil {
					env.Log.Printf("garmin: best efforts for %d: %v", a.ActivityID, err)
					detailErrs++
				} else if len(act.BestEfforts) > 0 {
					efforts++
				}
				fetched = true
			}
			if fetched {
				time.Sleep(200 * time.Millisecond) // be gentle with an unofficial API
			}
			if env.Store.UpsertActivity(act) {
				added++
			}
		}
		if len(list) < limit || reachedKnown {
			break
		}
	}
	env.Log.Printf("garmin: %d new activities, %d routes, %d weather records and %d best-effort sets fetched", added, routes, weathers, efforts)

	stepDays, err := g.syncSteps(env, api)
	if err != nil {
		return fmt.Errorf("daily steps: %w", err)
	}
	env.Log.Printf("garmin: %d days of steps updated", stepDays)

	if detailErrs > 0 {
		return fmt.Errorf("%d route/weather requests failed; run `lifelog sync -full garmin` to retry", detailErrs)
	}
	return nil
}

// fetchWeather returns the weather Garmin recorded from the nearest station
// when the activity was saved, or nil if it has none. Garmin reports °F and mph.
func fetchWeather(api func(string, any) error, id int64) (*model.Weather, error) {
	var w struct {
		Temp         *float64 `json:"temp"`
		ApparentTemp *float64 `json:"apparentTemp"`
		Humidity     float64  `json:"relativeHumidity"`
		WindSpeed    float64  `json:"windSpeed"`
		WindDir      string   `json:"windDirectionCompassPoint"`
		Type         *struct {
			Desc string `json:"desc"`
		} `json:"weatherTypeDTO"`
	}
	if err := api(fmt.Sprintf("/activity-service/activity/%d/weather", id), &w); err != nil {
		return nil, err
	}
	if w.Temp == nil {
		return nil, nil
	}
	c := func(f float64) float64 { return math.Round((f-32)*5/9*10) / 10 }
	out := &model.Weather{
		TempC:    c(*w.Temp),
		Humidity: w.Humidity,
		WindMS:   math.Round(w.WindSpeed*0.44704*10) / 10,
		WindDir:  strings.ToUpper(w.WindDir),
	}
	out.FeelsLikeC = out.TempC
	if w.ApparentTemp != nil {
		out.FeelsLikeC = c(*w.ApparentTemp)
	}
	if w.Type != nil {
		out.Desc = w.Type.Desc
	}
	return out, nil
}

// fetchEfforts computes best efforts from the activity's per-second distance and
// elapsed-time series (downsampled by Garmin to at most 4000 samples).
func fetchEfforts(api func(string, any) error, id int64) (map[string]float64, error) {
	var det struct {
		Descriptors []struct {
			Index int    `json:"metricsIndex"`
			Key   string `json:"key"`
		} `json:"metricDescriptors"`
		Rows []struct {
			M []*float64 `json:"metrics"`
		} `json:"activityDetailMetrics"`
	}
	if err := api(fmt.Sprintf("/activity-service/activity/%d/details?maxChartSize=4000&maxPolylineSize=1", id), &det); err != nil {
		return nil, err
	}
	dist, secs := -1, -1
	for _, d := range det.Descriptors {
		switch d.Key {
		case "sumDistance":
			dist = d.Index
		case "sumElapsedDuration":
			secs = d.Index
		}
	}
	if dist < 0 || secs < 0 {
		return nil, nil
	}
	pts := make([]effort.Point, 0, len(det.Rows))
	for _, r := range det.Rows {
		if dist < len(r.M) && secs < len(r.M) && r.M[dist] != nil && r.M[secs] != nil {
			pts = append(pts, effort.Point{T: *r.M[secs], D: *r.M[dist]})
		}
	}
	return effort.Best(pts), nil
}

// stepsChunk is how many days one daily-steps request covers (garth uses 28).
const stepsChunk = 28

// syncSteps stores daily step totals and goals. Incremental runs re-fetch the
// last week, since today's count keeps growing and the watch may sync late.
// Full runs walk backwards until half a year in a row has no data.
func (g Garmin) syncSteps(env *source.Env, api func(string, any) error) (int, error) {
	end := time.Now().In(env.Loc)
	oldest := end.AddDate(0, 0, -6)
	if env.Full {
		oldest = time.Time{}
	}
	days, emptyChunks := 0, 0
	for to := end; !to.Before(oldest) && emptyChunks < 7; to = to.AddDate(0, 0, -stepsChunk) {
		from := to.AddDate(0, 0, -(stepsChunk - 1))
		if from.Before(oldest) {
			from = oldest
		}
		var res []struct {
			CalendarDate string `json:"calendarDate"`
			TotalSteps   *int   `json:"totalSteps"` // null when the watch wasn't worn
			StepGoal     int    `json:"stepGoal"`
		}
		if err := api(fmt.Sprintf("/usersummary-service/stats/steps/daily/%s/%s",
			from.Format("2006-01-02"), to.Format("2006-01-02")), &res); err != nil {
			return days, err
		}
		found := 0
		for _, d := range res {
			if d.TotalSteps == nil || *d.TotalSteps == 0 {
				continue
			}
			env.Store.PutDaily(model.DailyMetric{Date: d.CalendarDate, Source: g.Name(), Metric: "steps", Value: float64(*d.TotalSteps)})
			if d.StepGoal > 0 {
				env.Store.PutDaily(model.DailyMetric{Date: d.CalendarDate, Source: g.Name(), Metric: "step_goal", Value: float64(d.StepGoal)})
			}
			found++
		}
		days += found
		if found == 0 {
			emptyChunks++
		} else {
			emptyChunks = 0
		}
		if env.Full {
			time.Sleep(200 * time.Millisecond)
		}
	}
	return days, nil
}

// fetchRoute downloads an activity's GPS track (downsampled by Garmin to at most
// 500 points, plenty for thumbnails and a map) as an encoded polyline.
func fetchRoute(api func(string, any) error, id int64) (string, error) {
	var det struct {
		GeoPolylineDTO struct {
			Polyline []struct {
				Lat float64 `json:"lat"`
				Lon float64 `json:"lon"`
			} `json:"polyline"`
		} `json:"geoPolylineDTO"`
	}
	if err := api(fmt.Sprintf("/activity-service/activity/%d/details?maxChartSize=1&maxPolylineSize=500", id), &det); err != nil {
		return "", err
	}
	var pts [][2]float64
	for _, p := range det.GeoPolylineDTO.Polyline {
		if p.Lat != 0 || p.Lon != 0 {
			pts = append(pts, [2]float64{p.Lat, p.Lon})
		}
	}
	return polyline.Encode(pts), nil
}
