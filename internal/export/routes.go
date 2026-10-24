package export

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/Jason-cqtan/lifelog/internal/seal"
)

// Routes are the private part of the export: data.json only says which
// activities have one, and the polylines go to RoutesFile as an AES-GCM blob
// keyed by the answer to a question. The site asks the question before the map.
//
// RoutesFile layout: salt (16) | nonce (12) | AES-256-GCM(gzip(JSON id -> polyline)).
// Key: PBKDF2-SHA256(seal.Normalize(answer), salt, RouteIter).
const (
	RoutesFile = "routes.enc"
	RouteIter  = seal.Iter
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

// SealRoutes encrypts id -> polyline for RoutesFile.
func SealRoutes(routes map[string]string, answer string) ([]byte, error) {
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
	salt := seal.Salt()
	aead, err := seal.Key(answer, salt, RouteIter)
	if err != nil {
		return nil, err
	}
	return append(salt, seal.Seal(aead, plain.Bytes(), nil)...), nil
}

// OpenRoutes is the inverse of SealRoutes (the frontend does the same with WebCrypto).
func OpenRoutes(blob []byte, answer string) (map[string]string, error) {
	if len(blob) < 16 {
		return nil, errors.New("routes blob too short")
	}
	aead, err := seal.Key(answer, blob[:16], RouteIter)
	if err != nil {
		return nil, err
	}
	plain, err := seal.Open(aead, blob[16:], nil)
	if err != nil {
		return nil, err
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
