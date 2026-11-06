// Package blog is the blog app of `lifelog serve`: posts are Markdown files
// with YAML front matter under one directory (data/blog in the repo, so the
// GitHub backup carries them), rendered on request at /blog/ and edited from
// the admin page.
//
//	data/blog/posts/2021-09/k8s01.md   →  /blog/posts/2021-09/k8s01/
//	data/blog/about.md (page: true)    →  /blog/about/   (not listed)
//	data/blog/media/...                →  /blog/media/...
package blog

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

type Post struct {
	Slug        string    `json:"slug" yaml:"-"`
	Title       string    `json:"title" yaml:"title"`
	Date        time.Time `json:"date" yaml:"date"`
	Description string    `json:"description,omitempty" yaml:"description,omitempty"`
	Tags        []string  `json:"tags,omitempty" yaml:"tags,omitempty"`
	Categories  []string  `json:"categories,omitempty" yaml:"categories,omitempty"`
	Series      []string  `json:"series,omitempty" yaml:"series,omitempty"`
	Cover       string    `json:"cover,omitempty" yaml:"cover,omitempty"`
	Draft       bool      `json:"draft,omitempty" yaml:"draft,omitempty"`
	// Page is a standalone page such as "about": reachable by its URL, not listed.
	Page bool   `json:"page,omitempty" yaml:"page,omitempty"`
	Body string `json:"body,omitempty" yaml:"-"`
	// Updated is the file's modification time, set by the store.
	Updated time.Time `json:"updated" yaml:"-"`
}

// Section is the first path segment: "posts", "notes", or "" for a top-level page.
func (p *Post) Section() string {
	if i := strings.IndexByte(p.Slug, '/'); i > 0 {
		return p.Slug[:i]
	}
	return ""
}

func (p *Post) URL() string { return "/blog/" + p.Slug + "/" }

// Listed reports whether the post appears in lists, feeds and the public API.
func (p *Post) Listed() bool { return !p.Draft && !p.Page }

// ReadingMinutes estimates reading time: about 400 CJK characters or 200 other
// words a minute.
func (p *Post) ReadingMinutes() int {
	cjk, words, inWord := 0, 0, false
	for _, r := range p.Body {
		switch {
		case r >= 0x2E80 && r <= 0x9FFF || r >= 0xAC00 && r <= 0xD7AF || r >= 0xF900 && r <= 0xFAFF:
			cjk++
			inWord = false
		case r == ' ' || r == '\n' || r == '\t':
			inWord = false
		default:
			if !inWord {
				words++
			}
			inWord = true
		}
	}
	m := (cjk*60/400 + words*60/200 + 59) / 60
	if m < 1 {
		m = 1
	}
	return m
}

var (
	segment       = `[\p{L}\p{N}][\p{L}\p{N}._-]*`
	slugPattern   = regexp.MustCompile(`^` + segment + `(/` + segment + `)*$`)
	reservedFirst = map[string]bool{"media": true, "tags": true, "static": true, "index.xml": true, "page": true}
)

// ValidSlug checks a slug before it becomes a file path and a URL.
func ValidSlug(slug string) error {
	if slug == "" {
		return errors.New("链接不能为空")
	}
	if len(slug) > 200 || !slugPattern.MatchString(slug) {
		return errors.New("链接只能包含文字、数字、. _ - 和用来分段的 /,如 posts/2026-11/hello")
	}
	for _, seg := range strings.Split(slug, "/") {
		if strings.HasSuffix(seg, ".md") || strings.Trim(seg, ".") == "" {
			return fmt.Errorf("链接里不能有 %q", seg)
		}
	}
	if reservedFirst[strings.SplitN(slug, "/", 2)[0]] {
		return fmt.Errorf("链接不能以 %s/ 开头(保留给网站使用)", strings.SplitN(slug, "/", 2)[0])
	}
	return nil
}

// Validate checks what the editor sends.
func (p *Post) Validate() error {
	if err := ValidSlug(p.Slug); err != nil {
		return err
	}
	if strings.TrimSpace(p.Title) == "" {
		return errors.New("标题不能为空")
	}
	if p.Date.IsZero() {
		return errors.New("日期不能为空")
	}
	if !utf8.ValidString(p.Body) {
		return errors.New("正文不是有效的 UTF-8")
	}
	return nil
}

// Marshal writes the post as a Markdown file with YAML front matter.
func (p *Post) Marshal() ([]byte, error) {
	fm, err := yaml.Marshal(p)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n\n")
	b.WriteString(strings.TrimLeft(p.Body, "\n"))
	if !strings.HasSuffix(p.Body, "\n") {
		b.WriteByte('\n')
	}
	return b.Bytes(), nil
}

// Parse reads a Markdown file with YAML front matter.
func Parse(slug string, data []byte) (*Post, error) {
	fm, body, err := splitFrontMatter(data, "---")
	if err != nil {
		return nil, err
	}
	p := &Post{Slug: slug}
	if err := yaml.Unmarshal(fm, p); err != nil {
		return nil, fmt.Errorf("%s: front matter: %w", slug, err)
	}
	p.Body = strings.TrimLeft(string(body), "\n")
	p.Tags, p.Categories, p.Series = clean(p.Tags), clean(p.Categories), clean(p.Series)
	return p, nil
}

func splitFrontMatter(data []byte, fence string) (fm, body []byte, err error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	if !bytes.HasPrefix(data, []byte(fence+"\n")) {
		return nil, data, nil
	}
	rest := data[len(fence)+1:]
	end := bytes.Index(rest, []byte("\n"+fence+"\n"))
	if end < 0 {
		if bytes.HasSuffix(rest, []byte("\n"+fence)) {
			return rest[:len(rest)-len(fence)-1], nil, nil
		}
		return nil, nil, errors.New("front matter is not closed")
	}
	return rest[:end], rest[end+len(fence)+2:], nil
}

// clean drops empty entries ("series: [-]" in old Hugo files) and duplicates.
func clean(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
