package applehealth

import (
	"strings"
	"testing"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="zh_CN">
 <Record type="HKQuantityTypeIdentifierStepCount" value="10"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Apple Watch" startDate="2026-10-20 07:00:00 +0800" endDate="2026-10-20 07:30:00 +0800">
  <MetadataEntry key="HKElevationAscended" value="4200 cm"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="5.2" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="152" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeHiking" duration="2" durationUnit="hr" totalDistance="8" totalDistanceUnit="km" sourceName="Apple Watch" startDate="2026-10-21 09:00:00 +0800"/>
</HealthData>`

func TestImport(t *testing.T) {
	st, _ := store.Open(t.TempDir(), "")
	n, err := Import(strings.NewReader(sample), st)
	if err != nil || n != 2 {
		t.Fatalf("Import = %d, %v", n, err)
	}
	acts := st.Activities()
	run, hike := acts[0], acts[1]
	if run.Type != model.Run || run.Distance != 5200 || run.MovingTime != 1800 || run.ElevationGain != 42 || run.AvgHeartRate != 152 {
		t.Errorf("run = %+v", run)
	}
	if run.StartTime.Hour() != 23 { // 07:00 +0800 is 23:00 UTC the day before
		t.Errorf("start not converted to UTC: %v", run.StartTime)
	}
	if hike.Type != model.Hike || hike.Distance != 8000 || hike.MovingTime != 7200 {
		t.Errorf("hike = %+v", hike)
	}
}
