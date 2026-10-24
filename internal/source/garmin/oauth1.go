package garmin

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// oauth1Header builds an HMAC-SHA1 OAuth 1.0a Authorization header (RFC 5849).
// params are the query and form-body parameters that must be part of the signature.
func oauth1Header(method, rawURL string, params url.Values, consumerKey, consumerSecret, token, tokenSecret string) string {
	nonce := make([]byte, 16)
	rand.Read(nonce)
	oauth := map[string]string{
		"oauth_consumer_key":     consumerKey,
		"oauth_nonce":            hex.EncodeToString(nonce),
		"oauth_signature_method": "HMAC-SHA1",
		"oauth_timestamp":        strconv.FormatInt(time.Now().Unix(), 10),
		"oauth_version":          "1.0",
	}
	if token != "" {
		oauth["oauth_token"] = token
	}
	oauth["oauth_signature"] = oauth1Signature(method, rawURL, params, oauth, consumerSecret, tokenSecret)

	keys := make([]string, 0, len(oauth))
	for k := range oauth {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = pct(k) + `="` + pct(oauth[k]) + `"`
	}
	return "OAuth " + strings.Join(parts, ", ")
}

func oauth1Signature(method, rawURL string, params url.Values, oauth map[string]string, consumerSecret, tokenSecret string) string {
	u, _ := url.Parse(rawURL)
	base := u.Scheme + "://" + u.Host + u.Path

	var pairs []string
	for k, vs := range params {
		for _, v := range vs {
			pairs = append(pairs, pct(k)+"="+pct(v))
		}
	}
	for k, v := range oauth {
		pairs = append(pairs, pct(k)+"="+pct(v))
	}
	sort.Strings(pairs)

	baseString := strings.ToUpper(method) + "&" + pct(base) + "&" + pct(strings.Join(pairs, "&"))
	mac := hmac.New(sha1.New, []byte(pct(consumerSecret)+"&"+pct(tokenSecret)))
	mac.Write([]byte(baseString))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// pct is RFC 3986 percent-encoding (url.QueryEscape encodes space as "+").
func pct(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }
