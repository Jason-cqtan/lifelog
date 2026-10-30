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
