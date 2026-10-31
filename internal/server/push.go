package server

import (
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/app"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/source/applehealth"
)

const (
	// workouts with routes are large; the app can split them with "Batch Requests"
	maxPushBody = 64 << 20
	// a push may come in batches: export the site once, after the last of them
	pushExportDelay = time.Minute
)

// pushAppleHealth receives workouts from the Health Auto Export iPhone app.
func (s *Server) pushAppleHealth(w http.ResponseWriter, r *http.Request) {
	token := source.Getenv(settings.PushToken)
	if token == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "push token not set"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad token"})
		return
	}
	st, err := app.OpenStore(r.Context(), s.pool)
	if err != nil {
		serverError(w, err)
		return
	}
	received, changed, err := applehealth.ImportPush(http.MaxBytesReader(w, r.Body, maxPushBody), st)
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	if changed > 0 {
		if err := st.Save(); err != nil {
			serverError(w, err)
			return
		}
		s.exportSoon()
	}
	log.Printf("serve: applehealth push: %d workouts, %d new or changed", received, changed)
	writeJSON(w, http.StatusOK, map[string]int{"received": received, "changed": changed})
}

// exportSoon exports the site after pushExportDelay, restarting the wait.
func (s *Server) exportSoon() {
	s.pushMu.Lock()
	defer s.pushMu.Unlock()
	if s.pushTimer != nil {
		s.pushTimer.Stop()
	}
	s.pushTimer = time.AfterFunc(pushExportDelay, func() {
		_, err := s.start("push", nil, false, false)
		switch {
		case errors.Is(err, errBusy): // that run may have read the store before the push
			s.exportSoon()
		case err != nil:
			log.Printf("serve: export after push: %v", err)
		}
	})
}
