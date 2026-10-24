package joyrun

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func TestSign(t *testing.T) {
	params := map[string]string{"year": "0", "timestamp": "1700000000"}
	// keys sorted: timestamp, year; then salt + uid + sid
	pre := "timestamp1700000000year0" + saltV1 + "42" + "abc"
	sum := md5.Sum([]byte(pre))
	if got, want := sign(params, saltV1, "42", "abc"), strings.ToUpper(hex.EncodeToString(sum[:])); got != want {
		t.Errorf("sign = %s, want %s", got, want)
	}
	// without a login, uid and sid are left out
	pre = "timestamp1700000000year0" + saltV2
	sum = md5.Sum([]byte(pre))
	if got, want := sign(params, saltV2, "0", "abc"), strings.ToUpper(hex.EncodeToString(sum[:])); got != want {
		t.Errorf("sign (no uid) = %s, want %s", got, want)
	}
}

func TestParseContent(t *testing.T) {
	pts, err := parseContent("[29512345,106561234]-[29512400,-106561300]")
	if err != nil || len(pts) != 2 || pts[0][0] != 29.512345 || pts[1][1] != -106.5613 {
		t.Fatalf("got %v, %v", pts, err)
	}
	if pts, _ := parseContent("[[1000000,2000000]]"); len(pts) != 1 || pts[0][0] != 1 {
		t.Errorf("bracketed form: %v", pts)
	}
}

func TestTimeline(t *testing.T) {
	// 5 points; a 60 s pause after point index 1 (pause index 2), run ends at 90 s
	pauses := [][]json.Number{{"2", "60"}}
	got := timeline(5, 90, pauses)
	want := []float64{0, 5, 70, 75, 90}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("timeline = %v, want %v", got, want)
		}
	}
}
