package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	cookieName = "lifelog_admin"
	sessionTTL = 30 * 24 * time.Hour
)

// auth is a single admin password: LIFELOG_ADMIN_PASSWORD from the
// environment until it is changed in the admin page, after which its bcrypt
// hash in the settings table wins. Sessions are HMAC-signed expiry times in a
// cookie; changing the password rotates the key and ends every session.
type auth struct {
	pool *pgxpool.Pool

	mu       sync.Mutex
	failures []time.Time
}

func (a *auth) key(r *http.Request) ([]byte, error) {
	m, err := settings.Load(r.Context(), a.pool)
	if err != nil {
		return nil, err
	}
	if k := m[settings.SessionKey]; k != "" {
		return hex.DecodeString(k)
	}
	return a.rotateKey(r)
}

func (a *auth) rotateKey(r *http.Request) ([]byte, error) {
	k := make([]byte, 32)
	rand.Read(k)
	return k, settings.Set(r.Context(), a.pool, settings.SessionKey, hex.EncodeToString(k))
}

func sign(key []byte, exp int64) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(strconv.FormatInt(exp, 10)))
	return strconv.FormatInt(exp, 10) + "." + hex.EncodeToString(m.Sum(nil))
}

func (a *auth) valid(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	expS, _, ok := strings.Cut(c.Value, ".")
	exp, err := strconv.ParseInt(expS, 10, 64)
	if !ok || err != nil || time.Now().Unix() > exp {
		return false
	}
	key, err := a.key(r)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(c.Value), []byte(sign(key, exp)))
}

func (a *auth) require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.valid(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "请先登录"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *auth) setCookie(w http.ResponseWriter, r *http.Request, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    value,
		Path:     "/api/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteStrictMode,
	})
}

// check compares password against the stored hash, else the environment.
func (a *auth) check(r *http.Request, password string) (bool, error) {
	m, err := settings.Load(r.Context(), a.pool)
	if err != nil {
		return false, err
	}
	if h := m[settings.AdminPasswordHash]; h != "" {
		return bcrypt.CompareHashAndPassword([]byte(h), []byte(password)) == nil, nil
	}
	env := envValue("LIFELOG_ADMIN_PASSWORD")
	if env == "" {
		return false, errors.New("还没有设置管理员密码：在服务器的 .env 里加 LIFELOG_ADMIN_PASSWORD 后重启")
	}
	return subtle.ConstantTimeCompare([]byte(env), []byte(password)) == 1, nil
}

// throttled allows 10 failed logins per 10 minutes, across all clients (one admin).
func (a *auth) throttled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	cut := time.Now().Add(-10 * time.Minute)
	kept := a.failures[:0]
	for _, t := range a.failures {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	a.failures = kept
	return len(kept) >= 10
}

func (a *auth) fail() {
	a.mu.Lock()
	a.failures = append(a.failures, time.Now())
	a.mu.Unlock()
	time.Sleep(time.Second)
}

func (a *auth) login(w http.ResponseWriter, r *http.Request) {
	if a.throttled() {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "尝试次数过多，请 10 分钟后再试"})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	ok, err := a.check(r, body.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok {
		a.fail()
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "密码不对"})
		return
	}
	a.issue(w, r)
}

func (a *auth) issue(w http.ResponseWriter, r *http.Request) {
	key, err := a.key(r)
	if err != nil {
		serverError(w, err)
		return
	}
	a.setCookie(w, r, sign(key, time.Now().Add(sessionTTL).Unix()), int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *auth) logout(w http.ResponseWriter, r *http.Request) {
	a.setCookie(w, r, "", -1)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *auth) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if len(body.New) < 10 {
		badRequest(w, "新密码至少 10 个字符")
		return
	}
	ok, err := a.check(r, body.Old)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok {
		a.fail()
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "原密码不对"})
		return
	}
	h, err := bcrypt.GenerateFromPassword([]byte(body.New), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := settings.Set(r.Context(), a.pool, settings.AdminPasswordHash, string(h)); err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.rotateKey(r); err != nil {
		serverError(w, err)
		return
	}
	a.issue(w, r) // this browser stays signed in; every other session ends
}
