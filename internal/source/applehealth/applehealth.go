// Package applehealth imports workouts from an Apple Health export
// (iPhone 健康 App -> 头像 -> 导出所有健康数据 -> export.zip -> apple_health_export/export.xml).
//
// Apple offers no server API, so this is a local import command rather than a
// scheduled sync: `lifelog import applehealth export.xml`, then commit data/.
package applehealth

import (
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/yourname/lifelog/internal/model"
	"github.com/yourname/lifelog/internal/store"
)

const timeLayout = "2006-01-02 15:04:05 -0700"

type workout struct {
	Type              string  `xml:"workoutActivityType,attr"`
	Duration          float64 `xml:"duration,attr"`
	DurationUnit      string  `xml:"durationUnit,attr"`
	TotalDistance     float64 `xml:"totalDistance,attr"`
	TotalDistanceUnit string  `xml:"totalDistanceUnit,attr"`
	SourceName        string  `xml:"sourceName,attr"`
	StartDate         string  `xml:"startDate,attr"`
	Stats             []struct {
		Type    string  `xml:"type,attr"`
		Sum     float64 `xml:"sum,attr"`
		Average float64 `xml:"average,attr"`
		Unit    string  `xml:"unit,attr"`
	} `xml:"WorkoutStatistics"`
	Metadata []struct {
		Key   string `xml:"key,attr"`
		Value string `xml:"value,attr"`
	} `xml:"MetadataEntry"`
}

// Import streams export.xml (often >1 GB) and upserts every <Workout>.
func Import(r io.Reader, st *store.Store) (added int, err error) {
	dec := xml.NewDecoder(r)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return added, nil
		}
		if err != nil {
			return added, err
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "Workout" {
			continue
		}
		var w workout
		if err := dec.DecodeElement(&w, &se); err != nil {
			return added, err
		}
		a, err := convert(w)
		if err != nil {
			continue
		}
		if st.UpsertActivity(a) {
			added++
		}
	}
}

func convert(w workout) (model.Activity, error) {
	start, err := time.Parse(timeLayout, w.StartDate)
	if err != nil {
		return model.Activity{}, err
	}
	raw := strings.TrimPrefix(w.Type, "HKWorkoutActivityType")

	dist := toMeters(w.TotalDistance, w.TotalDistanceUnit)
	var avgHR float64
	for _, s := range w.Stats {
		switch {
		case dist == 0 && strings.HasPrefix(s.Type, "HKQuantityTypeIdentifierDistance"):
			dist = toMeters(s.Sum, s.Unit) // newer iOS versions put distance here
		case s.Type == "HKQuantityTypeIdentifierHeartRate":
			avgHR = s.Average
		}
	}
	var elev float64
	for _, m := range w.Metadata {
		if m.Key == "HKElevationAscended" { // e.g. "12345 cm"
			if f := strings.Fields(m.Value); len(f) == 2 {
				v, _ := strconv.ParseFloat(f[0], 64)
				elev = toMeters(v, f[1])
			}
		}
	}
	secs := w.Duration
	switch w.DurationUnit {
	case "min":
		secs *= 60
	case "hr":
		secs *= 3600
	}
	return model.Activity{
		Source:        "applehealth",
		SourceID:      fmt.Sprintf("%d-%s", start.Unix(), raw),
		Type:          model.NormalizeType(raw),
		RawType:       raw,
		Name:          w.SourceName,
		StartTime:     start.UTC(),
		Distance:      dist,
		MovingTime:    int(secs),
		ElevationGain: elev,
		AvgHeartRate:  avgHR,
	}, nil
}

func toMeters(v float64, unit string) float64 {
	switch unit {
	case "km":
		return v * 1000
	case "mi":
		return v * 1609.344
	case "cm":
		return v / 100
	case "ft":
		return v * 0.3048
	}
	return v
}
