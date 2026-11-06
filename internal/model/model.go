// Package model holds the unified records every source is normalized into.
package model

import (
	"strings"
	"time"
)

type SportType string

const (
	Run     SportType = "run"
	Ride    SportType = "ride"
	Hike    SportType = "hike" // 徒步 / 爬山
	Walk    SportType = "walk"
	Swim    SportType = "swim"
	Workout SportType = "workout"
)

// Activity is one sport session, whatever watch or app it came from.
type Activity struct {
	Source        string    `json:"source"`
	SourceID      string    `json:"source_id"`
	Type          SportType `json:"type"`
	RawType       string    `json:"raw_type,omitempty"`
	Name          string    `json:"name,omitempty"`
	StartTime     time.Time `json:"start_time"`
	Distance      float64   `json:"distance_m"`
	MovingTime    int       `json:"moving_time_s"`
	ElapsedTime   int       `json:"elapsed_time_s,omitempty"`
	ElevationGain float64   `json:"elevation_gain_m,omitempty"`
	AvgHeartRate  float64   `json:"avg_hr,omitempty"`
	// steps per minute for runs/walks/hikes, pedal rpm for rides
	AvgCadence float64  `json:"avg_cadence,omitempty"`
	StrideM    float64  `json:"stride_m,omitempty"` // average stride length, meters
	Polyline   string   `json:"polyline,omitempty"` // Google encoded polyline
	Weather    *Weather `json:"weather,omitempty"`
	// Fastest elapsed seconds over standard distances inside this activity,
	// keyed by meters ("1000", "5000", ...); from time/distance samples.
	BestEfforts map[string]float64 `json:"best_efforts,omitempty"`
}

// Weather at the start of an activity, in metric units.
type Weather struct {
	TempC      float64 `json:"temp_c"`
	FeelsLikeC float64 `json:"feels_like_c"`
	Humidity   float64 `json:"humidity"` // percent
	WindMS     float64 `json:"wind_ms"`
	WindDir    string  `json:"wind_dir,omitempty"` // compass point, e.g. "SW"
	Desc       string  `json:"desc,omitempty"`     // provider's English description, e.g. "Cloudy"
}

func (a Activity) Key() string { return a.Source + ":" + a.SourceID }

// DailyMetric is one number per day per source, e.g. duolingo/minutes or github/contributions.
type DailyMetric struct {
	Date   string  `json:"date"` // YYYY-MM-DD in the configured timezone
	Source string  `json:"source"`
	Metric string  `json:"metric"`
	Value  float64 `json:"value"`
}

func (d DailyMetric) Key() string { return d.Date + "|" + d.Source + "|" + d.Metric }

// Play is one listened track. Spotify's API only exposes the last 50, so plays are
// accumulated over time and aggregated into daily minutes at export.
type Play struct {
	PlayedAt time.Time `json:"played_at"`
	Track    string    `json:"track"`
	Artist   string    `json:"artist,omitempty"`
	TrackID  string    `json:"track_id,omitempty"`
	MsPlayed int64     `json:"ms_played"`
}

func (p Play) Key() string { return p.PlayedAt.UTC().Format(time.RFC3339) + "|" + p.Track }

// Watch is one viewing of a movie or an episode: a Netflix data-export row or a
// Trakt history entry. Both can describe the same viewing; export decides
// which one counts (see export.Watching).
type Watch struct {
	Source   string `json:"source"` // netflix | trakt
	SourceID string `json:"source_id"`
	// Netflix: when playback started. Trakt: when it was marked watched.
	WatchedAt time.Time `json:"watched_at"`
	Kind      string    `json:"kind,omitempty"` // movie | episode
	Title     string    `json:"title"`          // the movie, or the show for an episode
	Episode   string    `json:"episode,omitempty"`
	// Seconds actually watched (Netflix) or the runtime (Trakt); 0 when unknown,
	// e.g. Netflix's basic viewing-history CSV, which has dates only.
	Seconds int    `json:"seconds,omitempty"`
	Device  string `json:"device,omitempty"`
}

func (w Watch) Key() string { return w.Source + ":" + w.SourceID }

// NormalizeType maps vendor activity types (Strava sport_type, Garmin typeKey,
// Apple HKWorkoutActivityType...) onto our small set.
func NormalizeType(raw string) SportType {
	s := strings.ToLower(raw)
	switch {
	case strings.Contains(s, "hik"), strings.Contains(s, "mountaineer"):
		return Hike
	case strings.Contains(s, "swim"):
		return Swim
	case strings.Contains(s, "walk"):
		return Walk
	case strings.Contains(s, "run"):
		return Run
	case strings.Contains(s, "ride"), strings.Contains(s, "cycl"), strings.Contains(s, "bik"):
		return Ride
	}
	return Workout
}

// SpotifyTop is Spotify's own "top items" ranking per time range
// (short_term ~4 weeks, medium_term ~6 months, long_term ~1 year).
type SpotifyTop struct {
	UpdatedAt time.Time           `json:"updated_at"`
	Ranges    map[string]TopLists `json:"ranges"`
}

type TopLists struct {
	Artists []TopArtist `json:"artists"`
	Tracks  []TopTrack  `json:"tracks"`
}

type TopArtist struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Image  string   `json:"image,omitempty"`
	Genres []string `json:"genres,omitempty"`
}

type TopTrack struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Artist string `json:"artist"`
	Album  string `json:"album,omitempty"`
	Image  string `json:"image,omitempty"`
}

// DuolingoCourses is a snapshot of cumulative XP per course. Non-language
// courses (chess, math, music) are not listed by Duolingo; their XP is the
// account total minus the listed courses.
type DuolingoCourses struct {
	UpdatedAt     time.Time        `json:"updated_at"`
	TrackedSince  time.Time        `json:"tracked_since"` // first snapshot; per-course daily XP starts here
	TotalXP       int64            `json:"total_xp"`
	CurrentCourse string           `json:"current_course,omitempty"`
	Courses       []DuolingoCourse `json:"courses"`
}

type DuolingoCourse struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Language string `json:"language"` // learning language code, e.g. "en", "zh-HK"
	XP       int64  `json:"xp"`
}

// OtherCourses is the pseudo-course for XP outside the listed language courses.
const OtherCourses = "OTHER"
