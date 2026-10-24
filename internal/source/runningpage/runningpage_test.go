package runningpage

import (
	"strings"
	"testing"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

func TestImport(t *testing.T) {
	const sample = `[
	 {"run_id": 1719073227000, "name": "run from gpx", "distance": 17068.75, "moving_time": "1:28:06", "type": "Run",
	  "start_date": "2024-06-23 00:20:27", "start_date_local": "2024-06-23 08:20:27", "summary_polyline": "_p~iF~ps|U",
	  "average_heartrate": 171.0, "average_speed": 3.2, "streak": 1},
	 {"run_id": 12345, "name": "", "distance": 100000, "moving_time": "1 day, 0:03:04", "type": "Run",
	  "start_date": "2019-03-08 15:21:14", "summary_polyline": "", "average_heartrate": null}
	]`
	st, _ := store.Open(t.TempDir(), "")
	n, err := Import(strings.NewReader(sample), st, "")
	if err != nil || n != 2 {
		t.Fatalf("Import = %d, %v", n, err)
	}
	a, ok := st.Activity("running_page:1719073227000")
	if !ok || a.Type != model.Run || a.MovingTime != 5286 || a.Distance != 17068.75 || a.AvgHeartRate != 171 || a.Polyline == "" {
		t.Errorf("got %+v", a)
	}
	if a.StartTime.Format("2006-01-02T15:04:05Z07:00") != "2024-06-23T00:20:27Z" {
		t.Errorf("start = %v", a.StartTime)
	}
	if b, _ := st.Activity("running_page:12345"); b.MovingTime != 86400+184 {
		t.Errorf("multi-day duration = %d", b.MovingTime)
	}
}
