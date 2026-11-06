// Client for `lifelog serve` (internal/server). Caddy proxies /api/ to it; in
// development Vite does (vite.config.ts).

export class Unauthorized extends Error {}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch('/api/admin/' + path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  })
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }))
  if (r.status === 401 && path !== 'login' && path !== 'password') throw new Unauthorized(data.error)
  if (!r.ok) throw new Error(data.error ?? `${r.status} ${r.statusText}`)
  return data as T
}

export type Kind = 'text' | 'bool' | 'secret'

export interface Setting {
  key: string
  group: string
  label: string
  help?: string
  kind: Kind
  default?: string
  value?: string
  set: boolean
  from?: 'db' | 'env' | 'default'
}

export interface SourceStats {
  name: string
  configured: boolean
  activities: number
  latest_activity?: string
  daily_rows: number
  latest_day?: string
  watches: number
  latest_watch?: string
}

export interface Overview {
  sources: SourceStats[]
  plays: number
  latest_play?: string
  running: number
  next_run?: string
  git_backup: boolean
  site_dir: string
}

export interface Run {
  id: number
  trigger: string
  sources: string
  started_at: string
  finished_at?: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  log?: string
}

// --- blog (internal/server/blog.go)

export interface PostSummary {
  slug: string
  title: string
  date: string
  updated: string
  section: string
  tags?: string[]
  draft?: boolean
  page?: boolean
}

export interface Post {
  slug: string
  title: string
  date: string
  description?: string
  tags?: string[]
  categories?: string[]
  series?: string[]
  cover?: string
  draft?: boolean
  page?: boolean
  body?: string
  updated?: string
}

export interface PostList {
  posts: PostSummary[]
  tags: Record<string, number>
  backup: boolean
}

// previewPost returns the post page's HTML, rendered as it will be published.
export async function previewPost(post: Post): Promise<string> {
  const r = await fetch('/api/admin/blog/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post }),
    credentials: 'same-origin',
  })
  if (r.status === 401) throw new Unauthorized()
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.text()
}

export async function uploadMedia(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch('/api/admin/blog/media', { method: 'POST', body: form, credentials: 'same-origin' })
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }))
  if (r.status === 401) throw new Unauthorized(data.error)
  if (!r.ok) throw new Error(data.error ?? `${r.status} ${r.statusText}`)
  return data.url as string
}
