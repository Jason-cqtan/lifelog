package blog

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// ImportHugo copies a Hugo site's posts into st: contentDir is its content/,
// staticImages its static/images (copied to media/images; may be empty).
// Section index files (_index.md) are skipped, except one with its own type
// and content, such as about/_index.md, which becomes a page. Existing posts with the same
// slug are replaced. Returns the number of posts written.
func ImportHugo(st *Store, contentDir, staticImages string, loc *time.Location) (int, error) {
	n := 0
	err := filepath.WalkDir(contentDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
			return err
		}
		rel, _ := filepath.Rel(contentDir, path)
		rel = filepath.ToSlash(strings.TrimSuffix(rel, ".md"))
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		p, typ, err := parseHugo(data, loc)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		slug := rel
		if strings.HasSuffix(rel, "/_index") || rel == "_index" {
			if typ == "" || strings.TrimSpace(p.Body) == "" {
				return nil // a section's list page
			}
			slug, p.Page = strings.TrimSuffix(rel, "/_index"), true
		}
		p.Slug = slug
		if err := ValidSlug(slug); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		if old, ok := st.Get(slug); ok {
			err = st.Save(p, old.Slug)
		} else {
			err = st.Save(p, "")
		}
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		n++
		return nil
	})
	if err != nil {
		return n, err
	}
	if staticImages != "" {
		if err := copyTree(staticImages, filepath.Join(st.Dir(), MediaDir, "images")); err != nil {
			return n, err
		}
	}
	return n, nil
}

type hugoMatter struct {
	Title         string    `yaml:"title" toml:"title"`
	Date          time.Time `yaml:"date"`
	Description   string    `yaml:"description"`
	Draft         bool      `yaml:"draft"`
	Tags          []string  `yaml:"tags"`
	Categories    []string  `yaml:"categories"`
	Series        []string  `yaml:"series"`
	FeaturedImage string    `yaml:"featured_image"`
	Type          string    `yaml:"type"`
}

func parseHugo(data []byte, loc *time.Location) (*Post, string, error) {
	var m hugoMatter
	fm, body, err := splitFrontMatter(data, "---")
	if err != nil {
		return nil, "", err
	}
	if fm != nil {
		if err := yaml.Unmarshal(fm, &m); err != nil {
			return nil, "", err
		}
	} else if fm, body, err = splitFrontMatter(data, "+++"); err != nil {
		return nil, "", err
	} else if fm != nil {
		m, err = parseTOML(fm, loc)
		if err != nil {
			return nil, "", err
		}
	}
	text := string(body)
	// Hugo served static/images at /images/
	text = strings.NewReplacer("](/images/", "](/blog/media/images/", `src="/images/`, `src="/blog/media/images/`).Replace(text)
	cover := m.FeaturedImage
	if cover != "" && !strings.Contains(cover, "://") && !strings.HasPrefix(cover, "/") {
		cover = "/blog/media/images/" + cover // Zzo resolved it under static/images
	} else if strings.HasPrefix(cover, "/images/") {
		cover = "/blog/media" + cover
	}
	p := &Post{
		Title: m.Title, Date: m.Date, Description: strings.TrimSpace(m.Description), Draft: m.Draft,
		Tags: clean(m.Tags), Categories: clean(m.Categories), Series: clean(m.Series), Cover: cover,
		Body: strings.TrimLeft(text, "\n"),
	}
	return p, m.Type, nil
}

// parseTOML reads the flat `key = "value"` front matter old Hugo pages use.
func parseTOML(fm []byte, loc *time.Location) (hugoMatter, error) {
	var m hugoMatter
	sc := bufio.NewScanner(bytes.NewReader(fm))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		switch k {
		case "title":
			m.Title = v
		case "description":
			m.Description = v
		case "type":
			m.Type = v
		case "draft":
			m.Draft = v == "true"
		case "date":
			for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
				if t, err := time.ParseInLocation(layout, v, loc); err == nil {
					m.Date = t
					break
				}
			}
		}
	}
	return m, sc.Err()
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if strings.HasPrefix(d.Name(), ".") {
			return nil
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
}
