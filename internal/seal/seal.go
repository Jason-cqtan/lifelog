// Package seal encrypts routes with a key derived from the map answer
// (PBKDF2-SHA256 -> AES-256-GCM). The repo's data/routes.json and the site's
// routes.enc both use it, so no route is ever stored or served in plain text.
package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"strings"
)

// Iter is the PBKDF2 iteration count for new keys.
const Iter = 300_000

// ErrWrongAnswer means the answer doesn't open the sealed data.
var ErrWrongAnswer = errors.New("wrong map answer")

// Normalize must match the frontend's: surrounding spaces and case don't count.
func Normalize(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// Salt returns a fresh random salt.
func Salt() []byte {
	b := make([]byte, 16)
	rand.Read(b)
	return b
}

// Key derives the AES-GCM cipher for answer.
func Key(answer string, salt []byte, iter int) (cipher.AEAD, error) {
	answer = Normalize(answer)
	if answer == "" {
		return nil, errors.New("empty map answer")
	}
	k, err := pbkdf2.Key(sha256.New, answer, salt, iter, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal returns nonce | ciphertext; aad binds it to its context (e.g. the activity id).
func Seal(aead cipher.AEAD, plain, aad []byte) []byte {
	nonce := make([]byte, aead.NonceSize())
	rand.Read(nonce)
	return aead.Seal(nonce, nonce, plain, aad)
}

// Open is the inverse of Seal.
func Open(aead cipher.AEAD, blob, aad []byte) ([]byte, error) {
	n := aead.NonceSize()
	if len(blob) < n+aead.Overhead() {
		return nil, errors.New("sealed data too short")
	}
	plain, err := aead.Open(nil, blob[:n], blob[n:], aad)
	if err != nil {
		return nil, ErrWrongAnswer
	}
	return plain, nil
}
