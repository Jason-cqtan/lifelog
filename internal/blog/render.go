package blog

import (
	"bytes"
	"html/template"
	"strings"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

type Heading struct {
	Level int
	ID    string
	Text  string
}

type rendered struct {
	HTML template.HTML
	TOC  []Heading
}

// md matches the old Hugo site: GitHub-flavoured, hard line breaks, raw HTML allowed
// (only the owner writes posts), heading anchors, highlighted code with CSS classes.
var md = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM,
		extension.Footnote,
		highlighting.NewHighlighting(
			highlighting.WithFormatOptions(chromahtml.WithClasses(true)),
			highlighting.WithGuessLanguage(false),
		),
	),
	goldmark.WithParserOptions(parser.WithAutoHeadingID()),
	goldmark.WithRendererOptions(html.WithHardWraps(), html.WithUnsafe()),
)

// Render turns Markdown into HTML and lists its h2/h3 headings for a table of contents.
func Render(body string) (*rendered, error) {
	src := []byte(body)
	doc := md.Parser().Parse(text.NewReader(src))
	var toc []Heading
	ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if h, ok := n.(*ast.Heading); ok && entering && (h.Level == 2 || h.Level == 3) {
			id, _ := h.AttributeString("id")
			idb, _ := id.([]byte)
			toc = append(toc, Heading{Level: h.Level, ID: string(idb), Text: plainText(h, src)})
		}
		return ast.WalkContinue, nil
	})
	var b bytes.Buffer
	if err := md.Renderer().Render(&b, src, doc); err != nil {
		return nil, err
	}
	return &rendered{HTML: template.HTML(b.String()), TOC: toc}, nil
}

func plainText(n ast.Node, src []byte) string {
	var b strings.Builder
	ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := c.(type) {
		case *ast.Text:
			b.Write(t.Segment.Value(src))
		case *ast.String:
			b.Write(t.Value)
		case *ast.CodeSpan:
			for x := t.FirstChild(); x != nil; x = x.NextSibling() {
				if tx, ok := x.(*ast.Text); ok {
					b.Write(tx.Segment.Value(src))
				}
			}
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

// rendered returns the post's HTML, cached until the next change.
func (s *Store) rendered(p *Post) (*rendered, error) {
	s.mu.RLock()
	r, ok := s.html[p.Slug]
	s.mu.RUnlock()
	if ok {
		return r, nil
	}
	r, err := Render(p.Body)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.html[p.Slug] = r
	s.mu.Unlock()
	return r, nil
}

// codeCSS is the highlighting theme for light and dark, following the site's
// data-theme attribute (and the OS setting when none is saved).
var codeCSS = func() string {
	f := chromahtml.New(chromahtml.WithClasses(true))
	var light, dark bytes.Buffer
	f.WriteCSS(&light, styles.Get("github"))
	f.WriteCSS(&dark, styles.Get("github-dark"))
	scope := func(css, prefix string) string {
		var out strings.Builder
		for _, line := range strings.Split(css, "\n") {
			if i := strings.Index(line, "*/ "); i >= 0 {
				line = line[i+3:]
			}
			if strings.TrimSpace(line) == "" {
				continue
			}
			// the code block background comes from blog.css
			if strings.HasPrefix(line, ".bg ") || strings.HasPrefix(line, ".chroma {") {
				continue
			}
			out.WriteString(prefix + line + "\n")
		}
		return out.String()
	}
	return scope(light.String(), "") +
		"@media (prefers-color-scheme: dark) {\n" + scope(dark.String(), ":root:not([data-theme='light']) ") + "}\n" +
		scope(dark.String(), ":root[data-theme='dark'] ")
}()
