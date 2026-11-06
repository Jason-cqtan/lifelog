package blog

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed site.html
var siteTemplates string

//go:embed blog.css
var blogCSS string

// SiteTitle and the sections shown as filters; other sections are listed under 全部 only.
const SiteTitle = "To be better me."

var Sections = []struct{ Key, Label string }{{"posts", "文章"}, {"notes", "随记"}}

func sectionLabel(key string) string {
	for _, s := range Sections {
		if s.Key == key {
			return s.Label
		}
	}
	return key
}

// Site serves the public blog under /blog/ and /api/blog/.
type Site struct {
	store  *Store
	loc    func() *time.Location
	tmpl   *template.Template
	css    []byte
	cssTag string
}

// NewSite serves st. loc gives the timezone dates are shown in.
func NewSite(st *Store, loc func() *time.Location) *Site {
	css := []byte(blogCSS + "\n/* code highlighting (chroma) */\n" + codeCSS)
	sum := sha256.Sum256(css)
	s := &Site{store: st, loc: loc, css: css, cssTag: hex.EncodeToString(sum[:])[:10]}
	s.tmpl = template.Must(template.New("site").Funcs(template.FuncMap{
		"date": func(t time.Time, layout string) string { return t.In(s.loc()).Format(layout) },
		"iso":  func(t time.Time) string { return t.Format(time.RFC3339) },
		"now":  func() int { return time.Now().In(s.loc()).Year() },
		"section": sectionLabel,
		"tagURL":  func(t string) string { return "/blog/tags/" + escapeSegment(t) + "/" },
	}).Parse(siteTemplates))
	return s
}

func (s *Site) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /blog", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/blog/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("GET /blog/{$}", s.index)
	mux.HandleFunc("GET /blog/index.xml", s.feed)
	mux.HandleFunc("GET /blog/static/blog.css", s.stylesheet)
	mux.HandleFunc("GET /blog/media/{file...}", s.media)
	mux.HandleFunc("GET /blog/tags/{tag}/{$}", s.tag)
	mux.HandleFunc("GET /blog/{slug...}", s.post)
	mux.HandleFunc("GET /api/blog/posts", s.apiPosts)
}

// --- pages

type listItem struct {
	*Post
	Minutes int
}

type yearGroup struct {
	Year  int
	Posts []listItem
}

type tagCount struct {
	Name  string
	Count int
}

type page struct {
	Title       string
	Description string
	CSS         string
	Canonical   string
	Nav         string // "blog" highlights the blog link

	// lists
	Heading  string
	Filter   string // section key or "tag"
	Sections any
	Years    []yearGroup
	Tags     []tagCount
	Total    int

	// post
	Post    *Post
	Body    template.HTML
	TOC     []Heading
	Minutes int
	Prev    *Post
	Next    *Post
	Preview bool
}

func (s *Site) base(title, desc, canonical string) page {
	return page{Title: title, Description: desc, CSS: "/blog/static/blog.css?v=" + s.cssTag, Canonical: canonical, Nav: "blog", Sections: Sections}
}

func (s *Site) index(w http.ResponseWriter, r *http.Request) {
	section := r.URL.Query().Get("s")
	all := s.store.All(true)
	var posts []*Post
	for _, p := range all {
		if section == "" || p.Section() == section {
			posts = append(posts, p)
		}
	}
	pg := s.base("博客 · "+SiteTitle, "Jason 的博客：编程、工具和生活随笔", "/blog/")
	pg.Heading, pg.Filter = "博客", section
	pg.Years, pg.Tags, pg.Total = s.group(posts), tagCounts(all), len(posts)
	s.render(w, http.StatusOK, "list", pg)
}

func (s *Site) tag(w http.ResponseWriter, r *http.Request) {
	tag := r.PathValue("tag")
	all := s.store.All(true)
	var posts []*Post
	for _, p := range all {
		for _, t := range p.Tags {
			if strings.EqualFold(t, tag) {
				posts = append(posts, p)
				break
			}
		}
	}
	if len(posts) == 0 {
		s.notFound(w)
		return
	}
	pg := s.base("#"+tag+" · 博客", "标签 "+tag+" 下的文章", "/blog/tags/"+escapeSegment(tag)+"/")
	pg.Heading, pg.Filter = "#"+tag, "tag"
	pg.Years, pg.Tags, pg.Total = s.group(posts), tagCounts(all), len(posts)
	s.render(w, http.StatusOK, "list", pg)
}

func (s *Site) post(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if !strings.HasSuffix(slug, "/") {
		if _, ok := s.store.Get(slug); ok {
			http.Redirect(w, r, "/blog/"+escapePath(slug)+"/", http.StatusMovedPermanently)
			return
		}
	}
	slug = strings.TrimSuffix(slug, "/")
	p, ok := s.store.Get(slug)
	if !ok || p.Draft {
		s.notFound(w)
		return
	}
	s.writePost(w, p, false)
}

// Preview renders an unsaved post exactly as its page will look, for the editor.
func (s *Site) Preview(w http.ResponseWriter, p *Post) {
	s.writePost(w, p, true)
}

func (s *Site) writePost(w http.ResponseWriter, p *Post, preview bool) {
	var (
		r   *rendered
		err error
	)
	if preview {
		r, err = Render(p.Body)
	} else {
		r, err = s.store.rendered(p)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	desc := p.Description
	if desc == "" {
		desc = excerpt(p.Body, 120)
	}
	pg := s.base(p.Title+" · "+SiteTitle, desc, p.URL())
	pg.Post, pg.Body, pg.Minutes, pg.Preview = p, r.HTML, p.ReadingMinutes(), preview
	if len(r.TOC) >= 3 {
		pg.TOC = r.TOC
	}
	if p.Listed() {
		all := s.store.All(true)
		for i, x := range all {
			if x.Slug == p.Slug {
				if i > 0 {
					pg.Next = all[i-1]
				}
				if i+1 < len(all) {
					pg.Prev = all[i+1]
				}
			}
		}
	}
	s.render(w, http.StatusOK, "post", pg)
}

func (s *Site) notFound(w http.ResponseWriter) {
	pg := s.base("找不到页面 · 博客", "", "")
	pg.Heading = "找不到这篇文章"
	s.render(w, http.StatusNotFound, "notfound", pg)
}

func (s *Site) render(w http.ResponseWriter, status int, name string, pg page) {
	var b bytes.Buffer
	if err := s.tmpl.ExecuteTemplate(&b, name, pg); err != nil {
		log.Printf("blog: render %s: %v", name, err)
		http.Error(w, "render error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	w.Write(b.Bytes())
}

func (s *Site) group(posts []*Post) []yearGroup {
	var out []yearGroup
	for _, p := range posts {
		y := p.Date.In(s.loc()).Year()
		if len(out) == 0 || out[len(out)-1].Year != y {
			out = append(out, yearGroup{Year: y})
		}
		g := &out[len(out)-1]
		g.Posts = append(g.Posts, listItem{Post: p, Minutes: p.ReadingMinutes()})
	}
	return out
}

func tagCounts(posts []*Post) []tagCount {
	n := map[string]int{}
	for _, p := range posts {
		for _, t := range p.Tags {
			n[t]++
		}
	}
	out := make([]tagCount, 0, len(n))
	for t, c := range n {
		out = append(out, tagCount{t, c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// --- assets

func (s *Site) stylesheet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	if r.URL.Query().Get("v") == s.cssTag {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.Write(s.css)
}

func (s *Site) media(w http.ResponseWriter, r *http.Request) {
	p := s.store.MediaPath(r.PathValue("file"))
	fi, err := os.Stat(p)
	if p == "" || err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if strings.EqualFold(path.Ext(p), ".svg") {
		// imported SVGs only (uploads refuse them); never run their scripts
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	}
	http.ServeFile(w, r, p)
}

// --- feeds

type apiPost struct {
	Slug        string    `json:"slug"`
	URL         string    `json:"url"`
	Title       string    `json:"title"`
	Date        time.Time `json:"date"`
	Description string    `json:"description,omitempty"`
	Section     string    `json:"section"`
	Tags        []string  `json:"tags,omitempty"`
	Minutes     int       `json:"minutes"`
}

// apiPosts lists published posts for the homepage: ?limit=N (default 10).
func (s *Site) apiPosts(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	all := s.store.All(true)
	out := make([]apiPost, 0, limit)
	for _, p := range all {
		if len(out) == limit {
			break
		}
		desc := p.Description
		if desc == "" {
			desc = excerpt(p.Body, 90)
		}
		out = append(out, apiPost{p.Slug, p.URL(), p.Title, p.Date, desc, p.Section(), p.Tags, p.ReadingMinutes()})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]any{"total": len(all), "posts": out})
}

func (s *Site) feed(w http.ResponseWriter, r *http.Request) {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
		scheme = "http"
	}
	root := scheme + "://" + r.Host
	type item struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		GUID        string `xml:"guid"`
		PubDate     string `xml:"pubDate"`
		Description string `xml:"description"`
	}
	type channel struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		Description string `xml:"description"`
		Language    string `xml:"language"`
		Items       []item `xml:"item"`
	}
	ch := channel{Title: SiteTitle, Link: root + "/blog/", Description: "Jason 的博客", Language: "zh-CN"}
	for i, p := range s.store.All(true) {
		if i == 30 {
			break
		}
		html := ""
		if rd, err := s.store.rendered(p); err == nil {
			html = string(rd.HTML)
		}
		ch.Items = append(ch.Items, item{p.Title, root + p.URL(), root + p.URL(), p.Date.Format(time.RFC1123Z), html})
	}
	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write([]byte(xml.Header))
	xml.NewEncoder(w).Encode(struct {
		XMLName xml.Name `xml:"rss"`
		Version string   `xml:"version,attr"`
		Channel channel  `xml:"channel"`
	}{Version: "2.0", Channel: ch})
}

// --- helpers

// excerpt is the first n characters of the text, without Markdown syntax.
func excerpt(body string, n int) string {
	var b strings.Builder
	inFence := false
	for _, line := range strings.Split(body, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") {
			inFence = !inFence
			continue
		}
		if inFence || t == "" || strings.HasPrefix(t, "<") || strings.HasPrefix(t, "![") || strings.HasPrefix(t, "|") {
			continue
		}
		t = strings.TrimLeft(t, "#>*-+ ")
		t = mdLink.ReplaceAllString(t, "$1")
		t = strings.NewReplacer("**", "", "__", "", "`", "").Replace(t)
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(t)
		if len([]rune(b.String())) > n {
			break
		}
	}
	r := []rune(b.String())
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return string(r)
}

var mdLink = regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`)

func escapeSegment(s string) string { return url.PathEscape(s) }

func escapePath(slug string) string {
	parts := strings.Split(slug, "/")
	for i, p := range parts {
		parts[i] = escapeSegment(p)
	}
	return strings.Join(parts, "/")
}

