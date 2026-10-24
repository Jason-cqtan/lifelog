// Package oauth holds helpers for the OAuth2 sources (Strava, Spotify): a local
// callback server for the one-time authorization, and refresh-token exchange.
package oauth

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/yourname/lifelog/internal/source"
)

// CallbackAddr must be registered as the redirect URI in the provider's app settings
// (Spotify only accepts loopback IPs, not "localhost").
const CallbackAddr = "127.0.0.1:8888"

var RedirectURI = "http://" + CallbackAddr + "/callback"

// WaitForCode prints authURL for the user to open and blocks until the provider
// redirects back with ?code=.
func WaitForCode(ctx context.Context, authURL string) (string, error) {
	ln, err := net.Listen("tcp", CallbackAddr)
	if err != nil {
		return "", err
	}
	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/callback" {
			http.NotFound(w, r)
			return
		}
		if e := r.URL.Query().Get("error"); e != "" {
			fmt.Fprintln(w, "授权失败:", e)
			errCh <- fmt.Errorf("authorization denied: %s", e)
			return
		}
		fmt.Fprintln(w, "授权成功,可以关闭此页面回到终端。")
		codeCh <- r.URL.Query().Get("code")
	})}
	go srv.Serve(ln)
	defer srv.Close()

	fmt.Println("在浏览器中打开以下链接完成授权:\n\n  " + authURL + "\n")
	select {
	case code := <-codeCh:
		return code, nil
	case err := <-errCh:
		return "", err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// TokenResponse covers the fields Strava and Spotify both return.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// PostToken posts a form to a token endpoint. basicAuth sends client credentials
// as HTTP Basic (Spotify) instead of in the form (Strava).
func PostToken(ctx context.Context, c *http.Client, tokenURL string, form url.Values, clientID, clientSecret string, basicAuth bool) (*TokenResponse, error) {
	if !basicAuth {
		form.Set("client_id", clientID)
		form.Set("client_secret", clientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if basicAuth {
		req.SetBasicAuth(clientID, clientSecret)
	}
	var tok TokenResponse
	if err := source.DoJSON(c, req, &tok); err != nil {
		return nil, err
	}
	return &tok, nil
}
