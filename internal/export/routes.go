package export

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

// Routes are the private part of the export: data.json only says which
// activities have one, and the polylines go to RoutesFile as an AES-GCM blob
// keyed by the answer to a question. The site asks the question before the map.
//
// RoutesFile layout: salt (16) | nonce (12) | AES-256-GCM(gzip(JSON id -> polyline)).
// Key: PBKDF2-SHA256(NormalizeAnswer(answer), salt, RouteIter).
const (
	RoutesFile = "routes.enc"
	RouteIter  = 300_000
)

// Lock configures route encryption; without one, routes are left out entirely.
type Lock struct {
	Question string
	Answer   string
}

// RouteLock tells the frontend what to ask and where the sealed routes are.
type RouteLock struct {
	Question string `json:"question"`
	File     string `json:"file"` // relative to data.json, versioned for caches
	Iter     int    `json:"iter"`
}

// NormalizeAnswer must match the frontend's: surrounding spaces and case don't count.
func NormalizeAnswer(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// SealRoutes encrypts id -> polyline for RoutesFile.
func SealRoutes(routes map[string]string, answer string) ([]byte, error) {
	answer = NormalizeAnswer(answer)
	if answer == "" {
		return nil, errors.New("empty map answer")
	}
	js, err := json.Marshal(routes)
	if err != nil {
		return nil, err
	}
	var plain bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&plain, gzip.BestCompression)
	zw.Write(js)
	if err := zw.Close(); err != nil {
		return nil, err
	}

	salt := make([]byte, 16)
	nonce := make([]byte, 12)
	rand.Read(salt)
	rand.Read(nonce)
	key, err := pbkdf2.Key(sha256.New, answer, salt, RouteIter, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	out := append(append(salt, nonce...), gcm.Seal(nil, nonce, plain.Bytes(), nil)...)
	return out, nil
}

// OpenRoutes is the inverse of SealRoutes (the frontend does the same with WebCrypto).
func OpenRoutes(blob []byte, answer string) (map[string]string, error) {
	if len(blob) < 28 {
		return nil, errors.New("routes blob too short")
	}
	key, err := pbkdf2.Key(sha256.New, NormalizeAnswer(answer), blob[:16], RouteIter, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, blob[16:28], blob[28:], nil)
	if err != nil {
		return nil, errors.New("wrong answer")
	}
	zr, err := gzip.NewReader(bytes.NewReader(plain))
	if err != nil {
		return nil, err
	}
	var routes map[string]string
	return routes, json.NewDecoder(zr).Decode(&routes)
}

func version(blob []byte) string {
	sum := sha256.Sum256(blob)
	return hex.EncodeToString(sum[:4])
}
