package blog

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// MediaDir holds images and other files referenced by posts, under the blog directory.
const MediaDir = "media"

var ErrNotFound = errors.New("文章不存在")

// Store keeps every post in memory and writes changes straight to its directory.
type Store struct {
	dir string

	mu    sync.RWMutex
	posts map[string]*Post
	html  map[string]*rendered // render cache, cleared on change

	// OnChange runs after a save or delete (outside the lock), e.g. to back up.
	OnChange func(what string)
}

// Open loads every *.md under dir; a missing dir is created.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, MediaDir), 0o755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, posts: map[string]*Post{}, html: map[string]*rendered{}}
	if err := s.Reload(); err != nil {
		return nil, err
	}
	return s, nil
}

// Reload re-reads the directory, after a git pull may have changed it. On an
// error the posts in memory stay as they were.
func (s *Store) Reload() error {
	// held throughout, so a save can't slip in between reading and swapping
	s.mu.Lock()
	defer s.mu.Unlock()
	posts := map[string]*Post{}
	err := filepath.WalkDir(s.dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(s.dir, path)
		if d.IsDir() {
			if rel == MediaDir || strings.HasPrefix(d.Name(), ".") && rel != "." {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".md") {
			return nil
		}
		slug := filepath.ToSlash(strings.TrimSuffix(rel, ".md"))
		p, err := s.read(slug)
		if err != nil {
			return err
		}
		posts[slug] = p
		return nil
	})
	if err != nil {
		return err
	}
	s.posts, s.html = posts, map[string]*rendered{}
	return nil
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) file(slug string) string {
	return filepath.Join(s.dir, filepath.FromSlash(slug)+".md")
}

func (s *Store) read(slug string) (*Post, error) {
	path := s.file(slug)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	p, err := Parse(slug, data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if fi, err := os.Stat(path); err == nil {
		p.Updated = fi.ModTime()
	}
	return p, nil
}

// Get returns a copy of the post.
func (s *Store) Get(slug string) (*Post, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.posts[slug]
	if !ok {
		return nil, false
	}
	c := *p
	return &c, true
}

// All returns copies of every post, newest first. With listed, only published,
// non-page posts.
func (s *Store) All(listed bool) []*Post {
	s.mu.RLock()
	out := make([]*Post, 0, len(s.posts))
	for _, p := range s.posts {
		if listed && !p.Listed() {
			continue
		}
		c := *p
		out = append(out, &c)
	}
	s.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].Date.Equal(out[j].Date) {
			return out[i].Date.After(out[j].Date)
		}
		return out[i].Slug < out[j].Slug
	})
	return out
}

// Save writes p. oldSlug is the slug it was loaded under ("" for a new post);
// when it differs, the post is renamed. It refuses to overwrite another post.
func (s *Store) Save(p *Post, oldSlug string) error {
	if err := p.Validate(); err != nil {
		return err
	}
	p.Tags, p.Categories, p.Series = clean(p.Tags), clean(p.Categories), clean(p.Series)
	data, err := p.Marshal()
	if err != nil {
		return err
	}
	s.mu.Lock()
	if _, taken := s.posts[p.Slug]; taken && p.Slug != oldSlug {
		s.mu.Unlock()
		return fmt.Errorf("链接 %s 已被另一篇文章使用", p.Slug)
	}
	if oldSlug != "" {
		if _, ok := s.posts[oldSlug]; !ok {
			s.mu.Unlock()
			return ErrNotFound
		}
	}
	path := s.file(p.Slug)
	err = writeAtomic(path, data)
	if err == nil && oldSlug != "" && oldSlug != p.Slug {
		err = s.remove(oldSlug)
	}
	if err == nil {
		delete(s.posts, oldSlug)
		c := *p
		c.Updated = time.Now()
		if fi, err := os.Stat(path); err == nil {
			c.Updated = fi.ModTime()
		}
		s.posts[p.Slug] = &c
		s.html = map[string]*rendered{}
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	s.changed("save " + p.Slug)
	return nil
}

func (s *Store) Delete(slug string) error {
	s.mu.Lock()
	if _, ok := s.posts[slug]; !ok {
		s.mu.Unlock()
		return ErrNotFound
	}
	err := s.remove(slug)
	if err == nil {
		delete(s.posts, slug)
		s.html = map[string]*rendered{}
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	s.changed("delete " + slug)
	return nil
}

// remove deletes a post's file and the directories it leaves empty.
func (s *Store) remove(slug string) error {
	path := s.file(slug)
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	for dir := filepath.Dir(path); dir != s.dir && strings.HasPrefix(dir, s.dir); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil { // not empty
			break
		}
	}
	return nil
}

func (s *Store) changed(what string) {
	if s.OnChange != nil {
		s.OnChange(what)
	}
}

// MediaPath returns the file for a /blog/media/ URL path, or "" if it escapes the media directory.
func (s *Store) MediaPath(rel string) string {
	clean := filepath.Clean("/" + rel)
	if clean == "/" {
		return ""
	}
	return filepath.Join(s.dir, MediaDir, filepath.FromSlash(clean))
}

// UploadExt lists the file types the editor may upload. No SVG or HTML: those
// could run script on this origin.
var UploadExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".avif": true, ".pdf": true, ".mp4": true}

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N}._-]+`)

// SaveMedia stores an upload under media/uploads/YYYY/MM/ and returns its URL.
func (s *Store) SaveMedia(name string, r io.Reader, now time.Time) (string, error) {
	ext := strings.ToLower(filepath.Ext(name))
	if !UploadExt[ext] {
		return "", fmt.Errorf("不支持的文件类型 %q,可上传图片(png/jpg/gif/webp/avif)、pdf、mp4", ext)
	}
	base := strings.Trim(unsafeName.ReplaceAllString(strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)), "-"), "-.")
	if base == "" {
		base = "file"
	}
	if len(base) > 60 {
		base = base[:60]
	}
	rel := filepath.Join("uploads", now.Format("2006"), now.Format("01"))
	dir := filepath.Join(s.dir, MediaDir, rel)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	for i := 0; i < 1000; i++ {
		fname := base + ext
		if i > 0 {
			fname = fmt.Sprintf("%s-%d%s", base, i, ext)
		}
		f, err := os.OpenFile(filepath.Join(dir, fname), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		_, err = io.Copy(f, r)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(f.Name())
			return "", err
		}
		s.changed("upload " + fname)
		return "/blog/" + MediaDir + "/" + filepath.ToSlash(filepath.Join(rel, fname)), nil
	}
	return "", errors.New("同名文件太多")
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
