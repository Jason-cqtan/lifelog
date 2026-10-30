package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenDB loads every record from PostgreSQL. Polylines are kept in plain text
// there (the database is private), so no map answer is needed to open it.
func OpenDB(ctx context.Context, pool *pgxpool.Pool) (*Store, error) {
	s := &Store{
		activities: map[string]model.Activity{},
		daily:      map[string]model.DailyMetric{},
		plays:      map[string]model.Play{},
		snapshots:  map[string]json.RawMessage{},
		pg:         pool,
		dirty:      newDirty(),
	}
	rows, err := pool.Query(ctx, `SELECT source, source_id, type, raw_type, name, start_time, distance_m,
		moving_time_s, elapsed_time_s, elevation_gain_m, avg_hr, avg_cadence, stride_m, polyline, weather, best_efforts
		FROM activities`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a model.Activity
		var weather, efforts []byte
		if err := rows.Scan(&a.Source, &a.SourceID, &a.Type, &a.RawType, &a.Name, &a.StartTime, &a.Distance,
			&a.MovingTime, &a.ElapsedTime, &a.ElevationGain, &a.AvgHeartRate, &a.AvgCadence, &a.StrideM, &a.Polyline,
			&weather, &efforts); err != nil {
			return nil, err
		}
		a.StartTime = a.StartTime.UTC()
		if weather != nil {
			if err := json.Unmarshal(weather, &a.Weather); err != nil {
				return nil, fmt.Errorf("activity %s weather: %w", a.Key(), err)
			}
		}
		if efforts != nil {
			if err := json.Unmarshal(efforts, &a.BestEfforts); err != nil {
				return nil, fmt.Errorf("activity %s best_efforts: %w", a.Key(), err)
			}
		}
		s.activities[a.Key()] = a
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = pool.Query(ctx, `SELECT to_char(date, 'YYYY-MM-DD'), source, metric, value FROM daily_metrics`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d model.DailyMetric
		if err := rows.Scan(&d.Date, &d.Source, &d.Metric, &d.Value); err != nil {
			return nil, err
		}
		s.daily[d.Key()] = d
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = pool.Query(ctx, `SELECT played_at, track, artist, track_id, ms_played FROM plays`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p model.Play
		if err := rows.Scan(&p.PlayedAt, &p.Track, &p.Artist, &p.TrackID, &p.MsPlayed); err != nil {
			return nil, err
		}
		p.PlayedAt = p.PlayedAt.UTC()
		s.plays[p.Key()] = p
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = pool.Query(ctx, `SELECT name, data FROM snapshots`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var data []byte
		if err := rows.Scan(&name, &data); err != nil {
			return nil, err
		}
		s.snapshots[name] = data
	}
	return s, rows.Err()
}

// ImportInto copies every record of s (e.g. a store opened from data/) into
// the database and returns that database store.
func (s *Store) ImportInto(ctx context.Context, pool *pgxpool.Pool) (*Store, error) {
	d, err := OpenDB(ctx, pool)
	if err != nil {
		return nil, err
	}
	for _, a := range s.activities {
		if old, ok := d.activities[a.Key()]; ok && a.Polyline == "" {
			a.Polyline = old.Polyline // data/ opened without the answer: keep the routes we have
		}
		d.UpsertActivity(a)
	}
	for _, x := range s.daily {
		d.PutDaily(x)
	}
	for _, p := range s.plays {
		d.AddPlay(p)
	}
	for name, b := range s.snapshots {
		d.snapshots[name] = b
		d.dirty.snapshots[name] = true
	}
	return d, d.Save()
}

// WriteFiles mirrors the store into JSON files under dir (the GitHub backup),
// sealing routes with answer. Records missing from s are dropped from dir.
func (s *Store) WriteFiles(dir, answer string) error {
	f, err := Open(dir, answer)
	if err != nil {
		// the answer changed since routes.json was written: start a fresh seal
		if f, err = Open(dir, ""); err != nil {
			return err
		}
		if err := f.Rekey(answer); err != nil {
			return err
		}
	}
	// Records are never deleted, so the files hold nothing the store lacks unless
	// it was never imported (a fresh server): refuse rather than wipe the history.
	missing := 0
	for k := range f.activities {
		if _, ok := s.activities[k]; !ok {
			missing++
		}
	}
	for k := range f.daily {
		if _, ok := s.daily[k]; !ok {
			missing++
		}
	}
	for k := range f.plays {
		if _, ok := s.plays[k]; !ok {
			missing++
		}
	}
	if missing > 0 {
		return fmt.Errorf("%s has %d records the database doesn't; run `lifelog db import -dir %s` first", dir, missing, dir)
	}
	f.activities, f.daily, f.plays = s.activities, s.daily, s.plays
	for name, b := range s.snapshots {
		f.snapshots[name] = b
	}
	if answer == "" {
		// routes stay out of the backup rather than going in unsealed
		acts := make(map[string]model.Activity, len(s.activities))
		for k, a := range s.activities {
			a.Polyline = ""
			acts[k] = a
		}
		f.activities = acts
	}
	return f.saveFiles()
}

func (s *Store) savePG() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	tx, err := s.pg.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var acts [][]any
	for k := range s.dirty.activities {
		a := s.activities[k]
		acts = append(acts, []any{a.Source, a.SourceID, string(a.Type), a.RawType, a.Name, a.StartTime, a.Distance,
			int32(a.MovingTime), int32(a.ElapsedTime), a.ElevationGain, a.AvgHeartRate, a.AvgCadence, a.StrideM, a.Polyline,
			jsonOrNil(a.Weather, a.Weather == nil), jsonOrNil(a.BestEfforts, len(a.BestEfforts) == 0)})
	}
	if err := copyUpsert(ctx, tx, "activities", []string{"source", "source_id", "type", "raw_type", "name", "start_time",
		"distance_m", "moving_time_s", "elapsed_time_s", "elevation_gain_m", "avg_hr", "avg_cadence", "stride_m", "polyline",
		"weather", "best_efforts"}, 2, true, acts); err != nil {
		return err
	}

	var daily [][]any
	for k := range s.dirty.daily {
		d := s.daily[k]
		date, err := time.Parse("2006-01-02", d.Date)
		if err != nil {
			return fmt.Errorf("daily %s: %w", k, err)
		}
		daily = append(daily, []any{date, d.Source, d.Metric, d.Value})
	}
	if err := copyUpsert(ctx, tx, "daily_metrics", []string{"date", "source", "metric", "value"}, 3, true, daily); err != nil {
		return err
	}

	var plays [][]any
	for k := range s.dirty.plays {
		p := s.plays[k]
		plays = append(plays, []any{p.PlayedAt, p.Track, p.Artist, p.TrackID, p.MsPlayed})
	}
	if err := copyUpsert(ctx, tx, "plays", []string{"played_at", "track", "artist", "track_id", "ms_played"}, 2, false, plays); err != nil {
		return err
	}

	for name := range s.dirty.snapshots {
		if _, err := tx.Exec(ctx, `INSERT INTO snapshots (name, data) VALUES ($1, $2)
			ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, name, []byte(s.snapshots[name])); err != nil {
			return fmt.Errorf("snapshot %s: %w", name, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.dirty = newDirty()
	return nil
}

// copyUpsert bulk-loads rows into a temporary copy of table, then merges them
// in; the first nKey columns are the primary key. Without update, existing
// rows are left alone.
func copyUpsert(ctx context.Context, tx pgx.Tx, table string, cols []string, nKey int, update bool, rows [][]any) error {
	if len(rows) == 0 {
		return nil
	}
	tmp := "tmp_" + table
	if _, err := tx.Exec(ctx, fmt.Sprintf(`CREATE TEMP TABLE %s (LIKE %s INCLUDING DEFAULTS) ON COMMIT DROP`, tmp, table)); err != nil {
		return err
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{tmp}, cols, pgx.CopyFromRows(rows)); err != nil {
		return fmt.Errorf("%s: %w", table, err)
	}
	list := strings.Join(cols, ", ")
	conflict := "DO NOTHING"
	if update {
		var set []string
		for _, c := range cols[nKey:] {
			set = append(set, c+" = EXCLUDED."+c)
		}
		set = append(set, "updated_at = now()")
		conflict = "DO UPDATE SET " + strings.Join(set, ", ")
	}
	q := fmt.Sprintf(`INSERT INTO %s (%s) SELECT %s FROM %s ON CONFLICT (%s) %s`,
		table, list, list, tmp, strings.Join(cols[:nKey], ", "), conflict)
	if _, err := tx.Exec(ctx, q); err != nil {
		return fmt.Errorf("%s: %w", table, err)
	}
	_, err := tx.Exec(ctx, "DROP TABLE "+tmp) // a second Save in the same tx would collide
	return err
}

func jsonOrNil(v any, empty bool) any {
	if empty {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // plain structs and maps: cannot fail
	}
	return string(b)
}
