package blog

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	var changes []string
	st.OnChange = func(w string) { changes = append(changes, w) }
	p := &Post{Slug: "posts/2026-11/hello", Title: "你好", Date: time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC),
		Tags: []string{"go", "", "go"}, Body: "## 一\n\n正文"}
	if err := st.Save(p, ""); err != nil {
		t.Fatal(err)
	}
	if err := st.Save(&Post{Slug: "posts/2026-11/hello", Title: "x", Date: p.Date}, ""); err == nil {
		t.Error("a new post overwrote an existing slug")
	}
	// rename moves the file and removes the empty directory
	p.Slug = "notes/hello"
	if err := st.Save(p, "posts/2026-11/hello"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "posts")); !os.IsNotExist(err) {
		t.Errorf("old directory left behind: %v", err)
	}
	st2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := st2.Get("notes/hello")
	if !ok || got.Title != "你好" || len(got.Tags) != 1 || got.Body != "## 一\n\n正文\n" || !got.Date.Equal(p.Date) {
		t.Fatalf("reloaded = %+v", got)
	}
	if err := st2.Delete("notes/hello"); err != nil || len(st2.All(false)) != 0 {
		t.Fatalf("delete: %v", err)
	}
	if len(changes) != 2 {
		t.Errorf("changes = %v", changes)
	}
}

func TestValidSlug(t *testing.T) {
	for _, ok := range []string{"about", "posts/2021-09/k8s01", "notes/2019-12/何以为家", "posts/go-snippets_01"} {
		if err := ValidSlug(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "../x", "posts/../x", "/x", "x/", "media/a", "tags/go", "a b", "posts/.hidden", "x.md"} {
		if ValidSlug(bad) == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestImportHugo(t *testing.T) {
	src := t.TempDir()
	write := func(rel, s string) {
		os.MkdirAll(filepath.Dir(filepath.Join(src, rel)), 0o755)
		os.WriteFile(filepath.Join(src, rel), []byte(s), 0o644)
	}
	write("content/posts/_index.md", "---\ntitle: Posts\ntype: posts\n---\n")
	write("content/posts/2021-09/k8s01.md", "---\ntitle: \"K8s\"\ndate: 2021-09-28T14:18:51+08:00\ndescription:\ntags:\n- k8s\nseries:\n-\nfeatured_image: \"cover/k.png\"\n---\n\n![a](/images/k8s/a.png \"x\")\n")
	write("content/about/_index.md", "+++\ntitle = \"关于我\"\ntype = \"about\"\ndate = \"2019-12-01\"\n+++\n\n你好\n")
	write("static/images/k8s/a.png", "png")

	st, _ := Open(filepath.Join(t.TempDir(), "blog"))
	n, err := ImportHugo(st, filepath.Join(src, "content"), filepath.Join(src, "static/images"), time.UTC)
	if err != nil || n != 2 {
		t.Fatalf("ImportHugo = %d, %v", n, err)
	}
	p, _ := st.Get("posts/2021-09/k8s01")
	if p == nil || p.Title != "K8s" || p.Cover != "/blog/media/images/cover/k.png" || len(p.Series) != 0 ||
		!strings.Contains(p.Body, "](/blog/media/images/k8s/a.png") {
		t.Errorf("post = %+v", p)
	}
	about, _ := st.Get("about")
	if about == nil || !about.Page || about.Title != "关于我" || about.Date.Year() != 2019 {
		t.Errorf("about = %+v", about)
	}
	if _, err := os.Stat(st.MediaPath("images/k8s/a.png")); err != nil {
		t.Error(err)
	}
}

func TestSite(t *testing.T) {
	st, _ := Open(t.TempDir())
	d := time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC)
	st.Save(&Post{Slug: "posts/a", Title: "Alpha <b>", Date: d, Tags: []string{"Go Lang"}, Body: "## H1\n\n## H2\n\n### H3\n\n```go\nfunc main() {}\n```\n"}, "")
	st.Save(&Post{Slug: "posts/b", Title: "Draft", Date: d, Draft: true, Body: "x"}, "")
	st.Save(&Post{Slug: "about", Title: "About", Date: d, Page: true, Body: "me"}, "")
	st.SaveMedia("x.png", strings.NewReader("png"), d)

	mux := http.NewServeMux()
	NewSite(st, func() *time.Location { return time.UTC }).Register(mux)
	get := func(path string) (int, string) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		b, _ := io.ReadAll(rec.Result().Body)
		return rec.Code, string(b)
	}
	code, body := get("/blog/")
	if code != 200 || !strings.Contains(body, "Alpha &lt;b&gt;") || strings.Contains(body, "Draft") || strings.Contains(body, ">About<") {
		t.Errorf("index %d: %s", code, body)
	}
	if code, _ := get("/blog/posts/a"); code != http.StatusMovedPermanently {
		t.Errorf("no trailing slash: %d", code)
	}
	code, body = get("/blog/posts/a/")
	if code != 200 || !strings.Contains(body, `<h2 id="h1">H1</h2>`) || !strings.Contains(body, `class="toc"`) || !strings.Contains(body, `class="chroma"`) {
		t.Errorf("post %d: %s", code, body)
	}
	if code, _ := get("/blog/posts/b/"); code != 404 {
		t.Errorf("draft served: %d", code)
	}
	if code, _ := get("/blog/about/"); code != 200 {
		t.Errorf("page: %d", code)
	}
	if code, body := get("/blog/tags/Go%20Lang/"); code != 200 || !strings.Contains(body, "Alpha") {
		t.Errorf("tag %d", code)
	}
	if code, body := get("/api/blog/posts"); code != 200 || !strings.Contains(body, `"total":1`) {
		t.Errorf("api %d %s", code, body)
	}
	if code, body := get("/blog/index.xml"); code != 200 || !strings.Contains(body, "<rss") {
		t.Errorf("feed %d", code)
	}
	if code, body := get("/blog/media/uploads/2026/01/x.png"); code != 200 || body != "png" {
		t.Errorf("media %d %q", code, body)
	}
	if code, _ := get("/blog/media/../../etc/passwd"); code == 200 {
		t.Error("media path escaped")
	}
}
