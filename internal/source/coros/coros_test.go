package coros

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Jason-cqtan/lifelog/internal/polyline"
)

const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="29.5" lon="106.6"><time>2024-01-01T00:00:00Z</time></trkpt>
<trkpt lat="29.51" lon="106.61"></trkpt>
</trkseg></trk></gpx>`

func TestFetchRoute(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/activity/detail/download":
			if r.Method != http.MethodPost || r.Header.Get("accesstoken") != "tok" {
				t.Errorf("download request: %s, token %q", r.Method, r.Header.Get("accesstoken"))
			}
			if q := r.URL.Query(); q.Get("labelId") != "42" || q.Get("sportType") != "100" || q.Get("fileType") != "1" {
				t.Errorf("download query: %s", r.URL.RawQuery)
			}
			fmt.Fprintf(w, `{"result":"0000","data":{"fileUrl":%q}}`, srv.URL+"/file.gpx")
		case "/file.gpx":
			fmt.Fprint(w, gpx)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	got, err := fetchRoute(srv.Client(), srv.URL, "tok", "42", 100)
	if err != nil {
		t.Fatal(err)
	}
	if want := polyline.Encode([][2]float64{{29.5, 106.6}, {29.51, 106.61}}); got != want {
		t.Fatalf("route %q, want %q", got, want)
	}
}

func TestFetchRouteNone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"result":"0000","data":{}}`)
	}))
	defer srv.Close()
	got, err := fetchRoute(srv.Client(), srv.URL, "tok", "42", 100)
	if err != nil || got != "" {
		t.Fatalf("got %q, %v", got, err)
	}
}
