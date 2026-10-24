package export

import "testing"

func TestSealRoutesRoundTrip(t *testing.T) {
	routes := map[string]string{"garmin:1": "_p~iF~ps|U_ulLnnqC_mqNvxq`@"}
	blob, err := SealRoutes(routes, " Tan ")
	if err != nil {
		t.Fatal(err)
	}
	got, err := OpenRoutes(blob, "tan") // spaces and case don't count
	if err != nil || got["garmin:1"] != routes["garmin:1"] {
		t.Fatalf("OpenRoutes = %v, %v", got, err)
	}
	if _, err := OpenRoutes(blob, "li"); err == nil {
		t.Fatal("a wrong answer must not open the routes")
	}
}
