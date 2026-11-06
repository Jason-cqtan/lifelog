// Package netflix imports Netflix viewing history. Netflix has no API, so this
// is import-only and reads either of its two exports:
//
//   - ViewingActivity.csv from "Download your personal information"
//     (netflix.com/account/getmyinfo, in the CONTENT_INTERACTION folder): every
//     playback with its start time (UTC), duration, device and profile. Use this.
//
//   - NetflixViewingHistory.csv from the Viewing activity page
//     (netflix.com/viewingactivity, "Download all"): title and date only, so
//     those rows count as titles but add no minutes.
//
//     lifelog import netflix [-profile NAME] FILE...
package netflix

import (
	"encoding/csv"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

// MinSeconds drops playbacks shorter than this: previews that autoplay while
// browsing, and accidental clicks.
const MinSeconds = 60

// Import reads one export file into st and returns how many new watches it
// added. profile picks a Netflix profile in a full export; it may be empty only
// when the export holds a single profile. loc is the timezone of the dates in
// the basic export (the full export is in UTC).
func Import(r io.Reader, st *store.Store, profile string, loc *time.Location) (int, error) {
	rows, err := csv.NewReader(stripBOM(r)).ReadAll()
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("empty file")
	}
	col := map[string]int{}
	for i, h := range rows[0] {
		col[strings.TrimSpace(h)] = i
	}
	_, hasStart := col["Start Time"]
	_, hasDate := col["Date"]
	switch {
	case hasStart:
		return importActivity(rows[1:], col, st, profile)
	case hasDate:
		return importHistory(rows[1:], col, st, loc)
	}
	return 0, fmt.Errorf("not a Netflix export: expected ViewingActivity.csv (Start Time, Duration, ...) or NetflixViewingHistory.csv (Title, Date), got columns %v", rows[0])
}

func importActivity(rows [][]string, col map[string]int, st *store.Store, profile string) (int, error) {
	get := func(row []string, name string) string {
		if i, ok := col[name]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}
	// A family account exports every profile; refuse to mix them silently.
	counts := map[string]int{}
	for _, row := range rows {
		counts[get(row, "Profile Name")]++
	}
	if profile == "" && len(counts) > 1 {
		return 0, fmt.Errorf("这份导出有多个档案，用 -profile 指定一个: %s", describe(counts))
	}
	if profile != "" && counts[profile] == 0 {
		return 0, fmt.Errorf("没有档案 %q,导出里有: %s", profile, describe(counts))
	}

	added := 0
	for _, row := range rows {
		if profile != "" && get(row, "Profile Name") != profile {
			continue
		}
		if get(row, "Supplemental Video Type") != "" { // trailers, teasers, recaps
			continue
		}
		start, err := time.Parse("2006-01-02 15:04:05", get(row, "Start Time"))
		if err != nil {
			continue
		}
		secs, ok := parseDuration(get(row, "Duration"))
		if !ok || secs < MinSeconds {
			continue
		}
		raw := get(row, "Title")
		if raw == "" {
			continue
		}
		title, episode := SplitTitle(raw)
		w := model.Watch{
			Source:    "netflix",
			SourceID:  start.Format(time.RFC3339) + "|" + raw,
			WatchedAt: start,
			Kind:      kind(episode),
			Title:     title,
			Episode:   episode,
			Seconds:   secs,
			Device:    get(row, "Device Type"),
		}
		if st.PutWatch(w) {
			added++
		}
	}
	return added, nil
}

func importHistory(rows [][]string, col map[string]int, st *store.Store, loc *time.Location) (int, error) {
	ti, di := col["Title"], col["Date"]
	var raw [][3]int
	var titles []string
	for _, row := range rows {
		if ti >= len(row) || di >= len(row) {
			continue
		}
		parts, ok := dateParts(row[di])
		if !ok || strings.TrimSpace(row[ti]) == "" {
			continue
		}
		raw = append(raw, parts)
		titles = append(titles, strings.TrimSpace(row[ti]))
	}
	order := dateOrder(raw)
	added := 0
	for i, p := range raw {
		d, ok := toDate(p, order, loc)
		if !ok {
			continue
		}
		title, episode := SplitTitle(titles[i])
		w := model.Watch{
			Source:    "netflix",
			SourceID:  d.Format("2006-01-02") + "|" + titles[i],
			WatchedAt: d,
			Kind:      kind(episode),
			Title:     title,
			Episode:   episode,
		}
		if st.PutWatch(w) {
			added++
		}
	}
	return added, nil
}

// seasonPart matches the part of a Netflix title naming a season or series:
// "Season 2", "Limited Series", "Part 1", "Volume 3", "第 2 季", "第一季", "第 1 部" ...
var seasonPart = regexp.MustCompile(`(?i)^(season|series|limited series|part|volume|collection|chapter|book)\b|\b(season|series)$|^第\s*[0-9一二三四五六七八九十百]+\s*[季部辑卷篇]|[季部]$|^シーズン|^시즌`)

// SplitTitle turns Netflix's "Show: Season 1: Episode" into the show and the
// rest. A title with no season-like part is treated as a movie.
func SplitTitle(raw string) (title, episode string) {
	norm := strings.ReplaceAll(raw, "：", ": ")
	parts := strings.Split(norm, ": ")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	for i := 1; i < len(parts); i++ {
		if seasonPart.MatchString(parts[i]) {
			return strings.Join(parts[:i], ": "), strings.Join(parts[i:], ": ")
		}
	}
	return strings.TrimSpace(raw), ""
}

func kind(episode string) string {
	if episode != "" {
		return "episode"
	}
	return "movie"
}

// parseDuration reads "H:MM:SS".
func parseDuration(s string) (int, bool) {
	p := strings.Split(s, ":")
	if len(p) != 3 {
		return 0, false
	}
	total := 0
	for _, x := range p {
		n, err := strconv.Atoi(x)
		if err != nil || n < 0 {
			return 0, false
		}
		total = total*60 + n
	}
	return total, true
}

var digits = regexp.MustCompile(`\d+`)

// dateParts splits a date such as "1/2/23", "2023/1/2" or "02.01.2023" into its three numbers.
func dateParts(s string) ([3]int, bool) {
	m := digits.FindAllString(s, -1)
	if len(m) != 3 {
		return [3]int{}, false
	}
	var out [3]int
	for i, x := range m {
		n, _ := strconv.Atoi(x)
		if i == 0 && len(x) == 4 {
			n = -n // marks year-first
		}
		out[i] = n
	}
	return out, true
}

type order int

const (
	ymd order = iota
	mdy
	dmy
)

// dateOrder works out how the whole file writes dates: Netflix uses the
// account's locale, so "1/2/23" may mean January 2 or February 1. A first
// number above 12 anywhere proves day-first; otherwise month-first.
func dateOrder(all [][3]int) order {
	if len(all) > 0 && all[0][0] < 0 {
		return ymd
	}
	for _, p := range all {
		if p[0] > 12 {
			return dmy
		}
	}
	return mdy
}

func toDate(p [3]int, o order, loc *time.Location) (time.Time, bool) {
	var y, m, d int
	switch o {
	case ymd:
		y, m, d = -p[0], p[1], p[2]
	case mdy:
		m, d, y = p[0], p[1], p[2]
	case dmy:
		d, m, y = p[0], p[1], p[2]
	}
	if y < 0 { // a year-first row in a file that is otherwise not
		return time.Time{}, false
	}
	if y < 100 {
		y += 2000
	}
	t := time.Date(y, time.Month(m), d, 12, 0, 0, 0, loc) // noon: the date only, safe from DST edges
	if t.Month() != time.Month(m) || t.Day() != d {
		return time.Time{}, false
	}
	return t, true
}

func describe(counts map[string]int) string {
	var names []string
	for n := range counts {
		names = append(names, n)
	}
	sort.Strings(names)
	var out []string
	for _, n := range names {
		out = append(out, fmt.Sprintf("%q(%d 条)", n, counts[n]))
	}
	return strings.Join(out, ", ")
}

func stripBOM(r io.Reader) io.Reader {
	buf := make([]byte, 3)
	n, _ := io.ReadFull(r, buf)
	if n == 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
		return r
	}
	return io.MultiReader(strings.NewReader(string(buf[:n])), r)
}
