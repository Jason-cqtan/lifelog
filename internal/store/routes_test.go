package store

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
)

const route = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

func TestRoutesStaySealed(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir, "Tan")
	if err != nil {
		t.Fatal(err)
	}
	a := model.Activity{Source: "garmin", SourceID: "1", Type: model.Run, StartTime: time.Unix(1e9, 0), Polyline: route}
	st.UpsertActivity(a)
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	acts, _ := os.ReadFile(filepath.Join(dir, "activities.json"))
	sealed, _ := os.ReadFile(filepath.Join(dir, "routes.json"))
	if bytes.Contains(acts, []byte("polyline")) || bytes.Contains(sealed, []byte(route)) {
		t.Fatalf("route stored in plain text:\n%s\n%s", acts, sealed)
	}

	// the right answer brings it back; saving again changes nothing
	st, err = Open(dir, " tan ")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := st.Activity(a.Key()); got.Polyline != route {
		t.Fatalf("Polyline = %q", got.Polyline)
	}
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	if again, _ := os.ReadFile(filepath.Join(dir, "routes.json")); !bytes.Equal(again, sealed) {
		t.Error("an unchanged route was sealed again (churns every commit)")
	}

	// a wrong answer must fail, not overwrite
	if _, err := Open(dir, "li"); err == nil {
		t.Error("a wrong answer opened routes.json")
	}

	// no answer: no routes, the sealed file untouched, and no new route accepted in plain text
	st, err = Open(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := st.Activity(a.Key()); got.Polyline != "" {
		t.Error("route visible without the answer")
	}
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	if after, _ := os.ReadFile(filepath.Join(dir, "routes.json")); !bytes.Equal(after, sealed) {
		t.Error("saving without the answer changed routes.json")
	}
	st.UpsertActivity(model.Activity{Source: "garmin", SourceID: "2", Type: model.Run, StartTime: time.Unix(2e9, 0), Polyline: route})
	if err := st.Save(); err == nil {
		t.Error("a new route was saved without the answer")
	}
}

func TestRekey(t *testing.T) {
	dir := t.TempDir()
	st, _ := Open(dir, "old")
	st.UpsertActivity(model.Activity{Source: "garmin", SourceID: "1", Type: model.Run, StartTime: time.Unix(1e9, 0), Polyline: route})
	st.Save()
	st, _ = Open(dir, "old")
	if err := st.Rekey("new"); err != nil {
		t.Fatal(err)
	}
	st.Save()
	if _, err := Open(dir, "old"); err == nil {
		t.Error("the old answer still opens routes.json")
	}
	st, err := Open(dir, "new")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := st.Activity("garmin:1"); got.Polyline != route {
		t.Fatalf("Polyline = %q", got.Polyline)
	}
}
