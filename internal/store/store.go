// Package store keeps all synced records as JSON files under data/.
//
// Plain JSON with one record per line (instead of a SQLite file like running_page)
// keeps the hourly commits from GitHub Actions small and diffable, so the repo
// does not balloon with binary database snapshots.
package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
)

type Store struct {
	dir        string
	activities map[string]model.Activity
	daily      map[string]model.DailyMetric
	plays      map[string]model.Play
	// snapshots are whole documents replaced on each sync (e.g. Spotify's top
	// lists), stored as data/snapshots/<name>.json
	snapshots map[string]json.RawMessage
}

func Open(dir string) (*Store, error) {
	s := &Store{
		dir:        dir,
		activities: map[string]model.Activity{},
		daily:      map[string]model.DailyMetric{},
		plays:      map[string]model.Play{},
		snapshots:  map[string]json.RawMessage{},
	}
	acts, err := readArray[model.Activity](filepath.Join(dir, "activities.json"))
	if err != nil {
		return nil, err
	}
	for _, a := range acts {
		s.activities[a.Key()] = a
	}
	daily, err := readArray[model.DailyMetric](filepath.Join(dir, "daily.json"))
	if err != nil {
		return nil, err
	}
	for _, d := range daily {
		s.daily[d.Key()] = d
	}
	files, _ := filepath.Glob(filepath.Join(dir, "spotify", "plays-*.json"))
	for _, f := range files {
		plays, err := readArray[model.Play](f)
		if err != nil {
			return nil, err
		}
		for _, p := range plays {
			s.plays[p.Key()] = p
		}
	}
	snaps, _ := filepath.Glob(filepath.Join(dir, "snapshots", "*.json"))
	for _, f := range snaps {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		s.snapshots[strings.TrimSuffix(filepath.Base(f), ".json")] = b
	}
	return s, nil
}

// PutSnapshot replaces the named snapshot document.
func (s *Store) PutSnapshot(name string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	s.snapshots[name] = append(b, '\n')
	return nil
}

// Snapshot decodes the named snapshot into v; ok is false if there is none.
func (s *Store) Snapshot(name string, v any) (ok bool, err error) {
	b, found := s.snapshots[name]
	if !found {
		return false, nil
	}
	return true, json.Unmarshal(b, v)
}

// UpsertActivity reports whether the activity is new.
func (s *Store) UpsertActivity(a model.Activity) bool {
	_, exists := s.activities[a.Key()]
	s.activities[a.Key()] = a
	return !exists
}

func (s *Store) Activity(key string) (model.Activity, bool) {
	a, ok := s.activities[key]
	return a, ok
}

func (s *Store) Activities() []model.Activity {
	out := make([]model.Activity, 0, len(s.activities))
	for _, a := range s.activities {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].StartTime.Equal(out[j].StartTime) {
			return out[i].StartTime.Before(out[j].StartTime)
		}
		return out[i].Key() < out[j].Key()
	})
	return out
}

// LatestActivity returns the start time of the newest activity from source, used
// as the cursor for incremental syncs.
func (s *Store) LatestActivity(source string) time.Time {
	var latest time.Time
	for _, a := range s.activities {
		if a.Source == source && a.StartTime.After(latest) {
			latest = a.StartTime
		}
	}
	return latest
}

func (s *Store) PutDaily(d model.DailyMetric) { s.daily[d.Key()] = d }

func (s *Store) Daily() []model.DailyMetric {
	out := make([]model.DailyMetric, 0, len(s.daily))
	for _, d := range s.daily {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out
}

func (s *Store) AddPlay(p model.Play) bool {
	if _, ok := s.plays[p.Key()]; ok {
		return false
	}
	s.plays[p.Key()] = p
	return true
}

func (s *Store) Plays() []model.Play {
	out := make([]model.Play, 0, len(s.plays))
	for _, p := range s.plays {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key() < out[j].Key() })
	return out
}

func (s *Store) LatestPlay() time.Time {
	var latest time.Time
	for _, p := range s.plays {
		if p.PlayedAt.After(latest) {
			latest = p.PlayedAt
		}
	}
	return latest
}

func (s *Store) Save() error {
	if err := writeArray(filepath.Join(s.dir, "activities.json"), s.Activities()); err != nil {
		return err
	}
	if err := writeArray(filepath.Join(s.dir, "daily.json"), s.Daily()); err != nil {
		return err
	}
	for name, b := range s.snapshots {
		path := filepath.Join(s.dir, "snapshots", name+".json")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, b, 0o644); err != nil {
			return err
		}
	}
	byYear := map[int][]model.Play{}
	for _, p := range s.Plays() {
		y := p.PlayedAt.UTC().Year()
		byYear[y] = append(byYear[y], p)
	}
	for y, plays := range byYear {
		if err := writeArray(filepath.Join(s.dir, "spotify", fmt.Sprintf("plays-%d.json", y)), plays); err != nil {
			return err
		}
	}
	return nil
}

func readArray[T any](path string) ([]T, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []T
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

// writeArray writes a valid JSON array with one compact record per line.
func writeArray[T any](path string, items []T) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	buf.WriteString("[\n")
	for i, it := range items {
		b, err := json.Marshal(it)
		if err != nil {
			return err
		}
		buf.Write(b)
		if i < len(items)-1 {
			buf.WriteString(",")
		}
		buf.WriteString("\n")
	}
	buf.WriteString("]\n")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// DateIn formats t as a local calendar date.
func DateIn(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("2006-01-02")
}
