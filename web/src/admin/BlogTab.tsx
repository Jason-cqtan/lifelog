import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { api, previewPost, uploadMedia, type Post, type PostList, type PostSummary } from './api'

type Guard = (e: unknown) => void

// Routes inside the tab: #blog, #blog/new, #blog/edit/<slug>
type View = { mode: 'list' } | { mode: 'edit'; slug: string | null }

function parseHash(): View {
  const h = decodeURIComponent(location.hash.slice(1))
  if (h === 'blog/new') return { mode: 'edit', slug: null }
  if (h.startsWith('blog/edit/')) return { mode: 'edit', slug: h.slice('blog/edit/'.length) }
  return { mode: 'list' }
}

const SECTIONS = [
  { key: 'posts', label: '文章' },
  { key: 'notes', label: '随记' },
  { key: 'page', label: '独立页面' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

const sectionOf = (p: { slug: string; page?: boolean }): SectionKey =>
  p.page ? 'page' : p.slug.startsWith('notes/') ? 'notes' : 'posts'

const fmtDate = (s: string) => new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtTime = (s: string) =>
  new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function BlogTab({ guard }: { guard: Guard }) {
  const [view, setView] = useState<View>(parseHash)
  useEffect(() => {
    const on = () => setView(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const open = (slug: string | null) => {
    location.hash = slug === null ? 'blog/new' : 'blog/edit/' + encodeURIComponent(slug)
  }
  const close = () => {
    location.hash = 'blog'
  }
  if (view.mode === 'edit') return <Editor key={view.slug ?? '(new)'} slug={view.slug} guard={guard} onClose={close} onSaved={(s) => history.replaceState(null, '', '#blog/edit/' + encodeURIComponent(s))} />
  return <PostListView guard={guard} onOpen={open} />
}

// --- list

function PostListView({ guard, onOpen }: { guard: Guard; onOpen: (slug: string | null) => void }) {
  const [data, setData] = useState<PostList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | SectionKey | 'draft'>('all')
  useEffect(() => {
    api<PostList>('blog/posts').then(setData).catch(guard).catch((e: Error) => setError(e.message))
  }, [guard])

  const shown = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.posts.filter((p) => {
      if (filter === 'draft' ? !p.draft : filter !== 'all' && sectionOf(p) !== filter) return false
      if (!needle) return true
      return p.title.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle) || p.tags?.some((t) => t.toLowerCase().includes(needle))
    })
  }, [data, q, filter])

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>
  const count = (f: typeof filter) =>
    f === 'all' ? data.posts.length : f === 'draft' ? data.posts.filter((p) => p.draft).length : data.posts.filter((p) => sectionOf(p) === f).length
  return (
    <>
      <section className="card actions">
        <div>
          <div className="stat-label">博客</div>
          <div className="stat">{data.posts.filter((p) => !p.draft && !p.page).length} 篇已发布</div>
          <div className="muted small">
            保存后立即生效 · GitHub 备份{data.backup ? '开(保存 2 分钟后提交)' : '关'} · <a href="/blog/" target="_blank" rel="noreferrer">查看博客 ↗</a>
          </div>
        </div>
        <div className="buttons">
          <button className="primary" onClick={() => onOpen(null)}>
            写新文章
          </button>
        </div>
      </section>

      <section className="card bl-list">
        <div className="bl-toolbar">
          <div className="bl-filters">
            {(['all', 'posts', 'notes', 'page', 'draft'] as const).map((f) => (
              <button key={f} className={f === filter ? 'tab active' : 'tab'} onClick={() => setFilter(f)}>
                {f === 'all' ? '全部' : f === 'draft' ? '草稿' : SECTIONS.find((s) => s.key === f)!.label}
                <span className="muted"> {count(f)}</span>
              </button>
            ))}
          </div>
          <input type="text" className="bl-search" placeholder="搜索标题、链接、标签" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table className="bl-table">
          <thead>
            <tr>
              <th>标题</th>
              <th className="bl-hide-sm">栏目</th>
              <th>日期</th>
              <th className="bl-hide-sm">修改于</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <PostRow key={p.slug} p={p} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted bl-empty">没有符合条件的文章</p>}
      </section>
    </>
  )
}

function PostRow({ p, onOpen }: { p: PostSummary; onOpen: (slug: string) => void }) {
  return (
    <tr onClick={() => onOpen(p.slug)}>
      <td>
        <div className="bl-title">
          {p.title}
          {p.draft && <span className="badge partial">草稿</span>}
        </div>
        <code>{p.slug}</code>
      </td>
      <td className="bl-hide-sm">{SECTIONS.find((s) => s.key === sectionOf(p))!.label}</td>
      <td className="bl-num">{fmtDate(p.date)}</td>
      <td className="bl-num bl-hide-sm muted">{fmtTime(p.updated)}</td>
    </tr>
  )
}

// --- editor

interface Form {
  slug: string
  title: string
  date: string // datetime-local
  section: SectionKey
  tags: string
  categories: string
  series: string
  description: string
  cover: string
  draft: boolean
  body: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const list = (s: string) =>
  s
    .split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean)

function toForm(p: Post): Form {
  return {
    slug: p.slug,
    title: p.title,
    date: toLocalInput(new Date(p.date)),
    section: sectionOf(p),
    tags: (p.tags ?? []).join(', '),
    categories: (p.categories ?? []).join(', '),
    series: (p.series ?? []).join(', '),
    description: p.description ?? '',
    cover: p.cover ?? '',
    draft: !!p.draft,
    body: p.body ?? '',
  }
}

function toPost(f: Form): Post {
  return {
    slug: f.slug.trim().replace(/^\/+|\/+$/g, ''),
    title: f.title.trim(),
    date: f.date ? new Date(f.date).toISOString() : '',
    page: f.section === 'page',
    tags: list(f.tags),
    categories: list(f.categories),
    series: list(f.series),
    description: f.description.trim() || undefined,
    cover: f.cover.trim() || undefined,
    draft: f.draft || undefined,
    body: f.body,
  }
}

// slugify keeps letters (Chinese too), digits, . _ -
const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)

function autoSlug(section: SectionKey, title: string, date: string) {
  const name = slugify(title) || 'untitled'
  if (section === 'page') return name
  const d = date ? new Date(date) : new Date()
  return `${section}/${d.getFullYear()}-${pad(d.getMonth() + 1)}/${name}`
}

// withSection moves a slug to another section, keeping the rest of its path.
function withSection(slug: string, section: SectionKey) {
  const parts = slug.split('/').filter(Boolean)
  if (parts[0] === 'posts' || parts[0] === 'notes') parts.shift()
  if (section === 'page') return parts[parts.length - 1] ?? ''
  return [section, ...parts].join('/')
}

type Layout = 'split' | 'write' | 'preview'

function Editor({ slug, guard, onClose, onSaved }: { slug: string | null; guard: Guard; onClose: () => void; onSaved: (slug: string) => void }) {
  const [form, setForm] = useState<Form | null>(null)
  const [saved, setSaved] = useState('') // JSON of the form as last loaded or saved
  const [oldSlug, setOldSlug] = useState(slug ?? '')
  const [slugTouched, setSlugTouched] = useState(slug !== null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [layout, setLayout] = useState<Layout>(() => (matchMedia('(max-width: 900px)').matches ? 'write' : 'split'))
  const [showMeta, setShowMeta] = useState(slug === null)
  const [preview, setPreview] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (slug === null) {
      const f: Form = { slug: '', title: '', date: toLocalInput(new Date()), section: 'posts', tags: '', categories: '', series: '', description: '', cover: '', draft: true, body: '' }
      f.slug = autoSlug(f.section, f.title, f.date)
      setForm(f)
      setSaved(JSON.stringify(f))
      return
    }
    api<Post>('blog/post?slug=' + encodeURIComponent(slug))
      .then((p) => {
        const f = toForm(p)
        setForm(f)
        setSaved(JSON.stringify(f))
      })
      .catch(guard)
      .catch((e: Error) => setError(e.message))
  }, [slug, guard])

  const dirty = form !== null && JSON.stringify(form) !== saved
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const set = (patch: Partial<Form>) =>
    setForm((f) => {
      if (!f) return f
      const next = { ...f, ...patch }
      if (!slugTouched && ('title' in patch || 'date' in patch || 'section' in patch)) next.slug = autoSlug(next.section, next.title, next.date)
      else if ('section' in patch) next.slug = withSection(next.slug, next.section)
      return next
    })

  // live preview, a moment after typing stops
  useEffect(() => {
    if (!form || layout === 'write') return
    const id = setTimeout(() => {
      const p = toPost(form)
      previewPost({ ...p, title: p.title || '(无标题)', slug: p.slug || 'preview' })
        .then(setPreview)
        .catch(guard)
        .catch(() => {})
    }, 400)
    return () => clearTimeout(id)
  }, [form, layout, guard])

  const save = useCallback(() => {
    if (!form || busy) return
    setBusy(true)
    setError(null)
    api<Post>('blog/post', { method: 'PUT', body: { old_slug: oldSlug, post: toPost(form) } })
      .then((p) => {
        const f = toForm(p)
        setForm(f)
        setSaved(JSON.stringify(f))
        setOldSlug(p.slug)
        setSlugTouched(true)
        onSaved(p.slug)
        setNotice(p.draft ? '已保存为草稿' : '已保存并发布')
        setTimeout(() => setNotice(null), 2500)
      })
      .catch(guard)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }, [form, busy, oldSlug, guard, onSaved])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const back = () => {
    if (dirty && !confirm('有未保存的修改，确定离开？')) return
    onClose()
  }

  const remove = () => {
    if (!oldSlug || !confirm(`删除「${form?.title || oldSlug}」？文件会从服务器删除(GitHub 备份的历史里还在)。`)) return
    api('blog/post?slug=' + encodeURIComponent(oldSlug), { method: 'DELETE' })
      .then(() => {
        setSaved(JSON.stringify(form))
        onClose()
      })
      .catch(guard)
      .catch((e: Error) => setError(e.message))
  }

  // insert text at the cursor (or replace the selection)
  const insert = (text: string) => {
    const ta = textarea.current
    setForm((f) => {
      if (!f) return f
      const start = ta?.selectionStart ?? f.body.length
      const end = ta?.selectionEnd ?? start
      const body = f.body.slice(0, start) + text + f.body.slice(end)
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus()
          ta.selectionStart = ta.selectionEnd = start + text.length
        }
      })
      return { ...f, body }
    })
  }

  const upload = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1)
      uploadMedia(file)
        .then((url) => {
          const name = file.name.replace(/\.[^.]+$/, '')
          insert(file.type.startsWith('image/') ? `![${name}](${url})\n` : `[${file.name}](${url})\n`)
        })
        .catch(guard)
        .catch((e: Error) => setError(`${file.name}: ${e.message}`))
        .finally(() => setUploading((n) => n - 1))
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      upload(e.clipboardData.files)
    }
  }
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length) {
      e.preventDefault()
      upload(e.dataTransfer.files)
    }
  }

  if (!form) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>
  const published = oldSlug !== '' && saved !== '' && !(JSON.parse(saved) as Form).draft
  const words = form.body.replace(/\s/g, '').length

  return (
    <div className="bl-editor">
      <div className="bl-head">
        <button className="link" onClick={back}>
          ← 文章列表
        </button>
        <input className="bl-title-input" placeholder="标题" value={form.title} onChange={(e) => set({ title: e.target.value })} autoFocus={slug === null} />
        <div className="bl-head-end">
          {notice && <span className="badge ok">{notice}</span>}
          {dirty && !notice && <span className="muted small">未保存</span>}
          {published && (
            <a href={'/blog/' + oldSlug + '/'} target="_blank" rel="noreferrer" className="small">
              查看 ↗
            </a>
          )}
          <label className="switch small" title="草稿不会出现在博客上">
            <input type="checkbox" checked={!form.draft} onChange={(e) => set({ draft: !e.target.checked })} />
            发布
          </label>
          <button className="primary" disabled={busy || !dirty} onClick={save} title="⌘S / Ctrl+S">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card bl-meta">
        <button className="link bl-meta-toggle" onClick={() => setShowMeta((v) => !v)}>
          {showMeta ? '▾' : '▸'} 文章信息 <span className="muted">{form.slug && `/blog/${form.slug}/`}</span>
        </button>
        {showMeta && (
          <div className="bl-fields">
            <label>
              栏目
              <select value={form.section} onChange={(e) => set({ section: e.target.value as SectionKey })}>
                {SECTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              日期
              <input type="datetime-local" value={form.date} onChange={(e) => set({ date: e.target.value })} />
            </label>
            <label className="bl-wide">
              链接
              <input
                type="text"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  set({ slug: e.target.value })
                }}
              />
              <span className="muted small">网址 /blog/{form.slug || '…'}/{oldSlug && form.slug !== oldSlug ? ' · 改了链接，旧网址会失效' : ''}</span>
            </label>
            <label>
              标签 <span className="muted small">逗号分隔</span>
              <input type="text" value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="go, 工具" />
            </label>
            <label>
              分类
              <input type="text" value={form.categories} onChange={(e) => set({ categories: e.target.value })} placeholder="开发" />
            </label>
            <label>
              系列
              <input type="text" value={form.series} onChange={(e) => set({ series: e.target.value })} />
            </label>
            <label>
              封面图
              <input type="text" value={form.cover} onChange={(e) => set({ cover: e.target.value })} placeholder="/blog/media/…" />
            </label>
            <label className="bl-wide">
              摘要 <span className="muted small">留空时取正文开头</span>
              <input type="text" value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </label>
          </div>
        )}
      </section>

      <div className="bl-toolbar">
        <div className="bl-filters">
          {(['write', 'split', 'preview'] as const).map((l) => (
            <button key={l} className={l === layout ? 'tab active' : 'tab'} onClick={() => setLayout(l)}>
              {{ write: '编辑', split: '分屏', preview: '预览' }[l]}
            </button>
          ))}
        </div>
        <div className="buttons">
          <span className="muted small">{words.toLocaleString()} 字{uploading > 0 && ` · 上传中 ${uploading}…`}</span>
          <button onClick={() => fileInput.current?.click()} title="也可以直接把图片粘贴或拖进正文">
            插入图片/文件
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/*,.pdf,.mp4"
            onChange={(e) => {
              if (e.target.files) upload(e.target.files)
              e.target.value = ''
            }}
          />
          {oldSlug && (
            <button className="bl-danger" onClick={remove}>
              删除
            </button>
          )}
        </div>
      </div>

      <div className={'bl-panes ' + layout}>
        {layout !== 'preview' && (
          <textarea
            ref={textarea}
            className="bl-body"
            value={form.body}
            spellCheck={false}
            placeholder="用 Markdown 写正文。图片可以直接粘贴或拖进来。"
            onChange={(e) => set({ body: e.target.value })}
            onPaste={onPaste}
            onDrop={onDrop}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                insert('  ')
              }
            }}
          />
        )}
        {layout !== 'write' && <iframe className="bl-preview" title="预览" srcDoc={preview} sandbox="allow-same-origin" />}
      </div>
    </div>
  )
}
