// Package joyrun downloads run tracks from 悦跑圈 (Joyrun) to compute best
// efforts for runs imported from running_page, whose GPX files don't go back that
// far. Unofficial API, ported from running_page's run_page/joyrun_sync.py.
//
// Login is by phone number + SMS code: request a code on the app's login
// screen (don't log in with it), then run `lifelog import joyrun`.
package joyrun

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/effort"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

const baseURL = "https://api.thejoyrun.com"

// Request signing salts from the Joyrun app (see joyrun_sync.py).
const (
	saltV1 = "1fd6e28fd158406995f77727b35bf20a"
	saltV2 = "0C077B1E70F5FDDE6F497C1315687F9C"
)

// pointInterval is Joyrun's fixed spacing of track points, in seconds; it has
// no per-point timestamps, only this cadence plus a list of pauses.
const pointInterval = 5

type Client struct {
	HTTP     *http.Client
	uid, sid string
}

func sign(params map[string]string, salt, uid, sid string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k + params[k])
	}
	if uid == "" || uid == "0" {
		uid, sid = "", ""
	}
	b.WriteString(salt + uid + sid)
	sum := md5.Sum([]byte(b.String()))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func (c *Client) do(ctx context.Context, method, path string, params map[string]string, out any) error {
	p := map[string]string{}
	for k, v := range params {
		p[k] = v
	}
	p["timestamp"] = strconv.FormatInt(time.Now().Unix(), 10)
	v1 := sign(p, saltV1, c.uid, c.sid)
	v2 := sign(p, saltV2, c.uid, c.sid)

	form := url.Values{}
	for k, v := range p {
		form.Set(k, v)
	}
	form.Set("signature", v1)
	var req *http.Request
	if method == http.MethodGet {
		req, _ = http.NewRequestWithContext(ctx, method, baseURL+path+"?"+form.Encode(), nil)
	} else {
		req, _ = http.NewRequestWithContext(ctx, method, baseURL+path, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("_sign", v2)
	req.Header.Set("Accept-Language", "en_US")
	req.Header.Set("User-Agent", "okhttp/3.10.0")
	req.Header.Set("MODELTYPE", "Xiaomi MI 5")
	req.Header.Set("SYSVERSION", "8.0.0")
	req.Header.Set("APPVERSION", "4.2.0")
	if c.uid != "" {
		login := "sid=" + c.sid + "&uid=" + c.uid
		req.Header.Set("ypcookie", login)
		req.AddCookie(&http.Cookie{Name: "ypcookie", Value: strings.ToLower(url.QueryEscape(login))})
	}
	return source.DoJSON(c.HTTP, req, out)
}

// Login exchanges a phone number and SMS code for a session.
func (c *Client) Login(ctx context.Context, phone, code string) error {
	var res struct {
		Ret  string `json:"ret"`
		Msg  string `json:"msg"`
		Data struct {
			Sid  string `json:"sid"`
			User struct {
				UID json.Number `json:"uid"`
			} `json:"user"`
		} `json:"data"`
	}
	// the double slash is what the app sends
	if err := c.do(ctx, http.MethodGet, "//user/login/phonecode", map[string]string{"phoneNumber": phone, "identifyingCode": code}, &res); err != nil {
		return err
	}
	if res.Ret != "0" {
		return fmt.Errorf("joyrun login: %s (%s)", res.Msg, res.Ret)
	}
	c.sid, c.uid = res.Data.Sid, res.Data.User.UID.String()
	return nil
}

// RunIDs lists every run of the account.
func (c *Client) RunIDs(ctx context.Context) ([]string, error) {
	var res struct {
		Datas []struct {
			Fid json.Number `json:"fid"`
		} `json:"datas"`
	}
	if err := c.do(ctx, http.MethodPost, "/userRunList.aspx", map[string]string{"year": "0"}, &res); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(res.Datas))
	for _, d := range res.Datas {
		ids = append(ids, d.Fid.String())
	}
	return ids, nil
}

// Run is one downloaded run with its track as time/distance samples.
type Run struct {
	ID       string
	Start    time.Time
	Meters   float64
	Points   int
	Efforts  map[string]float64
	Polyline [][2]float64
}

// Run downloads one run (WGS-84 coordinates) and computes its best efforts.
func (c *Client) Run(ctx context.Context, id string) (*Run, error) {
	var res struct {
		Record struct {
			Start   int64           `json:"starttime"`
			End     int64           `json:"endtime"`
			Meter   float64         `json:"meter"`
			Content string          `json:"content"`
			Pause   [][]json.Number `json:"pause"`
		} `json:"runrecord"`
	}
	if err := c.do(ctx, http.MethodPost, "/Run/GetInfo.aspx", map[string]string{"fid": id, "wgs": "1"}, &res); err != nil {
		return nil, err
	}
	r := res.Record
	pts, err := parseContent(r.Content)
	if err != nil {
		return nil, fmt.Errorf("run %s: %w", id, err)
	}
	run := &Run{ID: id, Start: time.Unix(r.Start, 0).UTC(), Meters: r.Meter, Points: len(pts), Polyline: pts}
	if len(pts) < 2 {
		return run, nil
	}
	ts := timeline(len(pts), r.End-r.Start, r.Pause)
	lat := make([]float64, len(pts))
	lng := make([]float64, len(pts))
	for i, p := range pts {
		lat[i], lng[i] = p[0], p[1]
	}
	// Points are 5 s apart already; 6.5 m/s drops GPS glitches, as for GPX.
	run.Efforts = effort.Best(effort.FromTrack(lat, lng, ts, 6.5, 0))
	return run, nil
}

// parseContent reads "[lat,lng]-[lat,lng]..." (values x 1e6) into degrees.
func parseContent(s string) ([][2]float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	s = strings.ReplaceAll(s, "]-[", "],[")
	if !strings.HasPrefix(s, "[[") {
		s = "[" + s + "]"
	}
	var raw [][]float64
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		return nil, fmt.Errorf("track content: %w", err)
	}
	out := make([][2]float64, 0, len(raw))
	for _, p := range raw {
		if len(p) >= 2 {
			out = append(out, [2]float64{p[0] / 1e6, p[1] / 1e6})
		}
	}
	return out, nil
}

// timeline rebuilds point times like running_page does: one point every 5 s,
// plus each pause (pause [i, secs] adds secs after point i-1), and the last
// point at the run's end.
func timeline(n int, total int64, pauses [][]json.Number) []float64 {
	ts := make([]float64, n)
	var t float64
	next := 0
	for i := 0; i < n-1; i++ {
		ts[i] = t
		t += pointInterval
		if next < len(pauses) && len(pauses[next]) >= 2 {
			idx, _ := pauses[next][0].Int64()
			if int(idx)-1 == i {
				secs, _ := pauses[next][1].Float64()
				t += secs
				next++
			}
		}
	}
	ts[n-1] = float64(total)
	if ts[n-1] < t-pointInterval { // inconsistent end time: keep the cadence
		ts[n-1] = t
	}
	return ts
}
