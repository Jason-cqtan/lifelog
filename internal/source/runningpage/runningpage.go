// Package runningpage imports history from a running_page / workouts_page
// deployment: `lifelog import running-page src/static/activities.json`.
//
// Records keep source "running_page"; where they overlap with a live source
// (e.g. the same Garmin run), export's dedupe keeps the live copy. With the
// repo's GPX_OUT folder, runs also get best efforts from their GPS tracks.
package runningpage

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/effort"
	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

type activity struct {
	RunID            json.Number `json:"run_id"`
	Name             string      `json:"name"`
	Distance         float64     `json:"distance"`
	MovingTime       string      `json:"moving_time"` // Python timedelta: "1:28:06" or "1 day, 0:03:04"
	Type             string      `json:"type"`
	StartDate        string      `json:"start_date"` // UTC "2006-01-02 15:04:05"
	SummaryPolyline  string      `json:"summary_polyline"`
	AverageHeartrate float64     `json:"average_heartrate"`
}

// Import reads activities.json; gpxDir ("" to skip) is running_page's GPX_OUT.
func Import(r io.Reader, st *store.Store, gpxDir string) (int, error) {
	var acts []activity
	if err := json.NewDecoder(r).Decode(&acts); err != nil {
		return 0, err
	}
	var tracks []track
	if gpxDir != "" {
		var err error
		if tracks, err = loadTracks(gpxDir); err != nil {
			return 0, err
		}
	}
	added := 0
	for _, a := range acts {
		start, err := time.Parse("2006-01-02 15:04:05", a.StartDate)
		if err != nil {
			return added, fmt.Errorf("run %s: %w", a.RunID, err)
		}
		secs, err := parseDuration(a.MovingTime)
		if err != nil {
			return added, fmt.Errorf("run %s: %w", a.RunID, err)
		}
		act := model.Activity{
			Source:       "running_page",
			SourceID:     a.RunID.String(),
			Type:         model.NormalizeType(a.Type),
			RawType:      a.Type,
			Name:         a.Name,
			StartTime:    start.UTC(),
			Distance:     a.Distance,
			MovingTime:   secs,
			AvgHeartRate: a.AverageHeartrate,
			Polyline:     a.SummaryPolyline,
		}
		if prev, ok := st.Activity(act.Key()); ok {
			act.BestEfforts = prev.BestEfforts
		}
		if tr := nearest(tracks, act.StartTime); tr != nil && act.Type == model.Run {
			act.BestEfforts = effort.Best(tr.points)
		}
		if st.UpsertActivity(act) {
			added++
		}
	}
	return added, nil
}

var durationRe = regexp.MustCompile(`^(?:(\d+) days?, )?(\d+):(\d{2}):(\d{2})(?:\.\d+)?$`)

func parseDuration(s string) (int, error) {
	m := durationRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("unrecognized moving_time %q", s)
	}
	n := func(i int) int { v, _ := strconv.Atoi(m[i]); return v }
	return n(1)*86400 + n(2)*3600 + n(3)*60 + n(4), nil
}

// GPX tracks from running_page's GPX_OUT, matched to activities by start time
// (file names are not reliably the run_id).
type track struct {
	start  time.Time
	points []effort.Point
}

const matchWindow = 10 * time.Minute

func nearest(tracks []track, start time.Time) *track {
	var best *track
	for i := range tracks {
		d := tracks[i].start.Sub(start)
		if d < 0 {
			d = -d
		}
		if d <= matchWindow && (best == nil || d < absDur(best.start.Sub(start))) {
			best = &tracks[i]
		}
	}
	return best
}

func absDur(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func loadTracks(dir string) ([]track, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.gpx"))
	if err != nil {
		return nil, err
	}
	var out []track
	for _, f := range files {
		tr, err := readGPX(f)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		if tr != nil {
			out = append(out, *tr)
		}
	}
	return out, nil
}

func readGPX(path string) (*track, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	var doc struct {
		Points []struct {
			Lat  float64 `xml:"lat,attr"`
			Lon  float64 `xml:"lon,attr"`
			Time string  `xml:"time"`
		} `xml:"trk>trkseg>trkpt"`
	}
	if err := xml.NewDecoder(fh).Decode(&doc); err != nil {
		return nil, err
	}
	var lat, lng, ts []float64
	var first time.Time
	for _, p := range doc.Points {
		t, err := time.Parse(time.RFC3339, p.Time)
		if err != nil {
			continue
		}
		if first.IsZero() {
			first = t
		}
		lat, lng, ts = append(lat, p.Lat), append(lng, p.Lon), append(ts, t.Sub(first).Seconds())
	}
	if len(ts) < 2 {
		return nil, nil
	}
	// Merge samples into >= 5 s steps; 6.5 m/s (2:34/km) is beyond any sustained
	// amateur pace, so faster steps are GPS glitches.
	return &track{start: first.UTC(), points: effort.FromTrack(lat, lng, ts, 6.5, 5)}, nil
}
