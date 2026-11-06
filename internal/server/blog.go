package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/app"
	"github.com/Jason-cqtan/lifelog/internal/blog"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
)

// blogBackupDelay batches a writing session's saves and uploads into one commit.
const blogBackupDelay = 2 * time.Minute

const maxUpload = 20 << 20

type blogApp struct {
	store *blog.Store
	site  *blog.Site
	repo  string // checkout the blog directory is in; "" when it is outside one

	mu      sync.Mutex
	timer   *time.Timer
	pending []string
}

func newBlogApp(dir, repo string) (*blogApp, error) {
	st, err := blog.Open(dir)
	if err != nil {
		return nil, err
	}
	b := &blogApp{store: st, site: blog.NewSite(st, location)}
	if repo != "" {
		absDir, _ := filepath.Abs(dir)
		absRepo, _ := filepath.Abs(repo)
		if rel, err := filepath.Rel(absRepo, absDir); err == nil && !strings.HasPrefix(rel, "..") {
			b.repo = absRepo
		} else {
			log.Printf("serve: blog dir %s is outside %s: no GitHub backup for posts", dir, repo)
		}
	}
	st.OnChange = b.backupSoon
	log.Printf("serve: blog: %d posts in %s", len(st.All(false)), dir)
	return b, nil
}

func (b *blogApp) backupSoon(what string) {
	if b.repo == "" || source.Getenv(settings.GitBackup) != "true" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = append(b.pending, what)
	if b.timer != nil {
		b.timer.Stop()
	}
	b.timer = time.AfterFunc(blogBackupDelay, b.backup)
}

func (b *blogApp) backup() {
	b.mu.Lock()
	what := b.pending
	b.pending = nil
	b.mu.Unlock()
	if len(what) == 0 {
		return
	}
	msg := "blog: " + what[0]
	if len(what) > 1 {
		msg += " (+" + strconv.Itoa(len(what)-1) + " more)"
	}
	abs, _ := filepath.Abs(b.store.Dir())
	rel, _ := filepath.Rel(b.repo, abs)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	logger := log.New(os.Stderr, "", log.LstdFlags)
	if err := app.GitPush(ctx, b.repo, rel, msg, logger, nil); err != nil {
		log.Printf("serve: blog backup: %v", err)
	}
	if err := b.store.Reload(); err != nil {
		log.Printf("serve: blog reload: %v", err)
	}
}

func (s *Server) reloadBlog(logger *log.Logger) {
	if s.blog == nil {
		return
	}
	if err := s.blog.store.Reload(); err != nil {
		logger.Printf("blog reload: %v", err)
	}
}

// location is the configured timezone (LIFELOG_TZ), or UTC if it is invalid.
func location() *time.Location {
	if loc, err := app.Location(); err == nil {
		return loc
	}
	return time.UTC
}

// --- admin API

type postSummary struct {
	Slug    string    `json:"slug"`
	Title   string    `json:"title"`
	Date    time.Time `json:"date"`
	Updated time.Time `json:"updated"`
	Section string    `json:"section"`
	Tags    []string  `json:"tags,omitempty"`
	Draft   bool      `json:"draft,omitempty"`
	Page    bool      `json:"page,omitempty"`
}

func (b *blogApp) register(private *http.ServeMux) {
	private.HandleFunc("GET /api/admin/blog/posts", b.list)
	private.HandleFunc("GET /api/admin/blog/post", b.get)
	private.HandleFunc("PUT /api/admin/blog/post", b.put)
	private.HandleFunc("DELETE /api/admin/blog/post", b.delete)
	private.HandleFunc("POST /api/admin/blog/preview", b.preview)
	private.HandleFunc("POST /api/admin/blog/media", b.upload)
}

func (b *blogApp) list(w http.ResponseWriter, r *http.Request) {
	all := b.store.All(false)
	out := make([]postSummary, 0, len(all))
	tags := map[string]int{}
	for _, p := range all {
		out = append(out, postSummary{p.Slug, p.Title, p.Date, p.Updated, p.Section(), p.Tags, p.Draft, p.Page})
		for _, t := range p.Tags {
			tags[t]++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": out, "tags": tags, "backup": b.repo != "" && source.Getenv(settings.GitBackup) == "true"})
}

func (b *blogApp) get(w http.ResponseWriter, r *http.Request) {
	p, ok := b.store.Get(r.URL.Query().Get("slug"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": blog.ErrNotFound.Error()})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (b *blogApp) put(w http.ResponseWriter, r *http.Request) {
	var body struct {
		OldSlug string     `json:"old_slug"`
		Post    *blog.Post `json:"post"`
	}
	if !readJSONLimit(w, r, &body, 4<<20) {
		return
	}
	if body.Post == nil {
		badRequest(w, "缺少 post")
		return
	}
	body.Post.Slug = strings.Trim(strings.TrimSpace(body.Post.Slug), "/")
	if err := b.store.Save(body.Post, body.OldSlug); err != nil {
		if errors.Is(err, blog.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "原文章已不存在(可能在别处被删除或改名)"})
			return
		}
		badRequest(w, err.Error())
		return
	}
	p, _ := b.store.Get(body.Post.Slug)
	writeJSON(w, http.StatusOK, p)
}

func (b *blogApp) delete(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-site request"})
		return
	}
	if err := b.store.Delete(r.URL.Query().Get("slug")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (b *blogApp) preview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Post *blog.Post `json:"post"`
	}
	if !readJSONLimit(w, r, &body, 4<<20) || body.Post == nil {
		return
	}
	if body.Post.Date.IsZero() {
		body.Post.Date = time.Now()
	}
	w.Header().Set("Cache-Control", "no-store")
	b.site.Preview(w, body.Post)
}

func (b *blogApp) upload(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-site request"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload+1<<20)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		badRequest(w, "上传失败(单个文件最大 20MB): "+err.Error())
		return
	}
	defer f.Close()
	url, err := b.store.SaveMedia(hdr.Filename, f, time.Now().In(location()))
	if err != nil {
		badRequest(w, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// sameOrigin guards the requests that are not JSON bodies (uploads, deletes)
// against cross-site forms, on top of the SameSite=Strict session cookie.
func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" {
		return site == "same-origin"
	}
	origin := r.Header.Get("Origin")
	return origin == "" || strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://") == r.Host
}
