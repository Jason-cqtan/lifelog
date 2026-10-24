package export

import (
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/polyline"
)

// Demo generates a year of fake data so the frontend can be developed before
// any account is connected. It never touches data/.
func Demo(loc *time.Location) Output {
	r := rand.New(rand.NewSource(42))
	out := Output{GeneratedAt: time.Now().UTC(), Timezone: loc.String(), Daily: map[string]map[string]float64{}}
	today := time.Now().In(loc)
	day0 := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc)
	n := 0
	for i := 400; i >= 0; i-- {
		day := day0.AddDate(0, 0, -i)
		date := day.Format("2006-01-02")
		m := map[string]float64{}
		addAct := func(t model.SportType, name string, km, paceMin float64, elev float64, hour int) {
			start := day.Add(time.Duration(hour)*time.Hour + time.Duration(r.Intn(50))*time.Minute)
			secs := int(km * paceMin * 60)
			n++
			out.Activities = append(out.Activities, Activity{
				ID: fmt.Sprintf("demo:%d", n), Source: "demo", Type: t, Name: name, Date: date,
				StartLocal: start.Format("2006-01-02 15:04"), Distance: round(km * 1000), MovingTime: secs,
				ElevationGain: round(elev), AvgHeartRate: float64(130 + r.Intn(35)),
				Polyline: polyline.Encode(fakeRoute(r, km)),
			})
			m[string(t)+"_km"] += round(km)
			m["sport_min"] += round(float64(secs) / 60)
		}
		wd := day.Weekday()
		if wd != time.Monday && r.Float64() < 0.55 {
			addAct(model.Run, "晨跑", 3+r.Float64()*9, 5+r.Float64()*1.5, 20+r.Float64()*60, 6)
		}
		if (wd == time.Saturday || wd == time.Wednesday) && r.Float64() < 0.6 {
			addAct(model.Ride, "骑行", 15+r.Float64()*45, 2.2+r.Float64()*0.8, 100+r.Float64()*500, 15)
		}
		if wd == time.Sunday && r.Float64() < 0.35 {
			addAct(model.Hike, "爬山", 6+r.Float64()*10, 14+r.Float64()*6, 400+r.Float64()*900, 8)
		}
		if r.Float64() < 0.92 {
			m["duolingo_minutes"] = round(5 + r.Float64()*25)
			m["duolingo_xp"] = math.Round(m["duolingo_minutes"] * (3 + r.Float64()*3))
		}
		m["spotify_minutes"] = round(r.Float64() * r.Float64() * 240)
		if wd != time.Saturday && wd != time.Sunday || r.Float64() < 0.3 {
			m["github_contributions"] = float64(r.Intn(14))
		}
		for k, v := range m {
			if v == 0 {
				delete(m, k)
			}
		}
		if len(m) > 0 {
			out.Daily[date] = m
		}
	}
	// newest first, like Build
	for i, j := 0, len(out.Activities)-1; i < j; i, j = i+1, j-1 {
		out.Activities[i], out.Activities[j] = out.Activities[j], out.Activities[i]
	}
	return out
}

// fakeRoute draws a wobbly loop near West Lake, Hangzhou.
func fakeRoute(r *rand.Rand, km float64) [][2]float64 {
	radius := km / (2 * math.Pi) / 111 // degrees
	cx, cy := 30.25+r.Float64()*0.05, 120.13+r.Float64()*0.05
	phase := r.Float64() * 10
	var pts [][2]float64
	for i := 0; i <= 80; i++ {
		a := float64(i) / 80 * 2 * math.Pi
		rr := radius * (1 + 0.25*math.Sin(3*a+phase) + 0.1*math.Sin(7*a))
		pts = append(pts, [2]float64{cx + rr*math.Sin(a), cy + rr*math.Cos(a)*1.15})
	}
	return pts
}
