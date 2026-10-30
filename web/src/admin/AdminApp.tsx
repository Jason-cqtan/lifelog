import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, Unauthorized, type Overview, type Run, type Setting } from './api'

const TABS = { overview: '概览', settings: '设置', runs: '同步记录' } as const
type Tab = keyof typeof TABS

const SOURCE_LABEL: Record<string, string> = {
  garmin: 'Garmin',
  coros: 'COROS 高驰',
  strava: 'Strava',
  duolingo: '多邻国',
  spotify: 'Spotify',
  github: 'GitHub 贡献',
  applehealth: 'Apple 健康',
  running_page: 'running_page',
}
const TRIGGER_LABEL: Record<string, string> = { schedule: '定时', admin: '手动', 'admin-export': '重新导出', cli: '命令行' }
const STATUS_LABEL: Record<Run['status'], string> = { running: '运行中', ok: '成功', partial: '部分失败', failed: '失败' }

const fmtTime = (s?: string) =>
  s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1)
    return h in TABS ? (h as Tab) : 'overview'
  })
  // a run the overview just started, so the runs tab opens on it
  const [openRun, setOpenRun] = useState<number | null>(null)

  useEffect(() => {
    api('me').then(() => setAuthed(true), () => setAuthed(false))
    const onHash = () => {
      const h = location.hash.slice(1)
      if (h in TABS) setTab(h as Tab)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', '#' + t)
  }
  // any 401 (session expired, password changed elsewhere) goes back to the login form
  const guard = useCallback((e: unknown) => {
    if (e instanceof Unauthorized) setAuthed(false)
    else throw e
  }, [])

  if (authed === null) return null
  if (!authed) return <Login onDone={() => setAuthed(true)} />

  return (
    <div className="admin">
      <header className="bar">
        <h1>Lifelog 后台</h1>
        <nav>
          {(Object.keys(TABS) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => go(t)}>
              {TABS[t]}
            </button>
          ))}
        </nav>
        <div className="bar-end">
          <a href="/" target="_blank" rel="noreferrer">查看网站 ↗</a>
          <button className="link" onClick={() => api('logout', { body: {} }).finally(() => setAuthed(false))}>
            退出
          </button>
        </div>
      </header>
      <main>
        {tab === 'overview' && (
          <OverviewTab
            guard={guard}
            onStarted={(id) => {
              setOpenRun(id)
              go('runs')
            }}
          />
        )}
        {tab === 'settings' && <SettingsTab guard={guard} />}
        {tab === 'runs' && <RunsTab guard={guard} initial={openRun} />}
      </main>
    </div>
  )
}

type Guard = (e: unknown) => void

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    api('login', { body: { password } })
      .then(onDone, (err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }
  return (
    <form className="login card" onSubmit={submit}>
      <h1>Lifelog 后台</h1>
      <label>
        管理员密码
        <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !password}>
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  )
}

function OverviewTab({ guard, onStarted }: { guard: Guard; onStarted: (id: number) => void }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api<Overview>('overview').then(setData).catch(guard).catch((e: Error) => setError(e.message))
  }, [guard])
  useEffect(load, [load])
  // follow a running sync until it ends
  useEffect(() => {
    if (!data?.running) return
    const id = setTimeout(load, 3000)
    return () => clearTimeout(id)
  }, [data, load])

  const start = (body: { sources?: string[]; full?: boolean; export_only?: boolean }) => {
    setError(null)
    api<{ id: number }>('sync', { body })
      .then((r) => onStarted(r.id))
      .catch(guard)
      .catch((e: Error) => setError(e.message))
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>
  const busy = data.running !== 0
  return (
    <>
      <section className="card actions">
        <div>
          <div className="stat-label">下次自动同步</div>
          <div className="stat">{data.next_run ? fmtTime(data.next_run) : '未设置'}</div>
          <div className="muted small">
            {busy ? `同步 #${data.running} 运行中…` : '空闲'} · GitHub 备份{data.git_backup ? '开' : '关'}
          </div>
        </div>
        <div className="buttons">
          <button className="primary" disabled={busy} onClick={() => start({})}>
            立即同步全部
          </button>
          <button disabled={busy} onClick={() => start({ export_only: true })} title="不拉取数据，只按当前设置重新生成网站的 data.json">
            只重新导出网站
          </button>
        </div>
      </section>
      {error && <p className="error">{error}</p>}

      <section className="grid">
        {data.sources.map((s) => {
          const syncable = s.name in SOURCE_LABEL && !['applehealth', 'running_page'].includes(s.name)
          return (
            <article key={s.name} className="card source">
              <header>
                <h2>{SOURCE_LABEL[s.name] ?? s.name}</h2>
                {syncable && <span className={s.configured ? 'badge ok' : 'badge'}>{s.configured ? '已配置' : '未配置'}</span>}
                {!syncable && <span className="badge">导入</span>}
              </header>
              <dl>
                {s.activities > 0 && (
                  <>
                    <dt>运动记录</dt>
                    <dd>
                      {s.activities.toLocaleString()} 条 · 最近 {fmtTime(s.latest_activity)}
                    </dd>
                  </>
                )}
                {s.daily_rows > 0 && (
                  <>
                    <dt>每日数值</dt>
                    <dd>
                      {s.daily_rows.toLocaleString()} 条 · 最近 {s.latest_day}
                    </dd>
                  </>
                )}
                {s.name === 'spotify' && (
                  <>
                    <dt>播放记录</dt>
                    <dd>
                      {data.plays.toLocaleString()} 首 · 最近 {fmtTime(data.latest_play)}
                    </dd>
                  </>
                )}
                {s.activities === 0 && s.daily_rows === 0 && s.name !== 'spotify' && <dd className="muted">还没有数据</dd>}
              </dl>
              {syncable && (
                <footer>
                  <button disabled={busy || !s.configured} onClick={() => start({ sources: [s.name] })}>
                    同步
                  </button>
                  <button
                    className="link"
                    disabled={busy || !s.configured}
                    onClick={() => confirm(`重新拉取 ${SOURCE_LABEL[s.name]} 的全部历史？可能要几分钟。`) && start({ sources: [s.name], full: true })}
                  >
                    全量
                  </button>
                </footer>
              )}
            </article>
          )
        })}
      </section>
    </>
  )
}

function SettingsTab({ guard }: { guard: Guard }) {
  const [items, setItems] = useState<Setting[] | null>(null)
  // edited values by key; '' clears a setting
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ items: Setting[] }>('settings')
      .then((r) => setItems(r.items))
      .catch(guard)
      .catch((e: Error) => setError(e.message))
  }, [guard])

  const groups = useMemo(() => {
    const m = new Map<string, Setting[]>()
    for (const s of items ?? []) m.set(s.group, [...(m.get(s.group) ?? []), s])
    return [...m]
  }, [items])

  const edit = (key: string, v: string) => {
    setSaved(false)
    setDraft((d) => ({ ...d, [key]: v }))
  }
  const dirty = Object.keys(draft).length > 0

  const save = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    api<{ items: Setting[] }>('settings', { method: 'PUT', body: { values: draft } })
      .then((r) => {
        setItems(r.items)
        setDraft({})
        setSaved(true)
      })
      .catch(guard)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  if (!items) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>
  return (
    <>
      <form onSubmit={save}>
        {groups.map(([group, list]) => (
          <section key={group} className="card settings">
            <h2>{group}</h2>
            {list.map((s) => (
              <SettingRow key={s.key} s={s} value={draft[s.key]} onChange={(v) => edit(s.key, v)} onReset={() => {
                setDraft(({ [s.key]: _, ...rest }) => rest)
              }} />
            ))}
          </section>
        ))}
        <div className="savebar">
          {error && <span className="error">{error}</span>}
          {saved && !dirty && <span className="muted">已保存，下次同步生效;地图设置在重新导出后生效</span>}
          <button className="primary" disabled={!dirty || busy}>
            {busy ? '保存中…' : dirty ? `保存 ${Object.keys(draft).length} 项修改` : '没有修改'}
          </button>
        </div>
      </form>
      <PasswordForm guard={guard} />
    </>
  )
}

function SettingRow({ s, value, onChange, onReset }: { s: Setting; value?: string; onChange: (v: string) => void; onReset: () => void }) {
  const edited = value !== undefined
  const source =
    s.from === 'env' ? '来自环境变量(保存后改存数据库)' : s.from === 'default' ? '默认值' : null
  let input
  if (s.kind === 'bool') {
    const cur = edited ? value : s.value ?? ''
    input = (
      <label className="switch">
        <input type="checkbox" checked={cur === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        <span>{cur === 'true' ? '开' : '关'}</span>
      </label>
    )
  } else if (s.kind === 'secret') {
    input = (
      <div className="secret">
        <input
          type="password"
          autoComplete="new-password"
          placeholder={s.set ? '已设置 · 输入新值以替换' : '未设置'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
        {s.set && s.from === 'db' && !edited && (
          <button type="button" className="link" onClick={() => confirm(`清除「${s.group} · ${s.label}」？`) && onChange('')}>
            清除
          </button>
        )}
      </div>
    )
  } else {
    input = (
      <input
        type="text"
        spellCheck={false}
        placeholder={s.default}
        value={edited ? value : s.from === 'default' ? '' : s.value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <div className={edited ? 'row edited' : 'row'}>
      <div className="row-label">
        <span>{s.label}</span>
        <code>{s.key}</code>
      </div>
      <div className="row-input">
        {input}
        <div className="row-help">
          {s.help && <span>{s.help}</span>}
          {source && !edited && <span className="tag">{source}</span>}
          {edited && (
            <button type="button" className="link" onClick={onReset}>
              {s.kind === 'secret' && value === '' ? '撤销清除' : '撤销'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PasswordForm({ guard }: { guard: Guard }) {
  const [old, setOld] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    api('password', { body: { old, new: next } })
      .then(() => {
        setOld('')
        setNext('')
        setMsg({ ok: true, text: '密码已修改，其他已登录的浏览器需要重新登录' })
      })
      .catch(guard)
      .catch((err: Error) => setMsg({ ok: false, text: err.message }))
  }
  return (
    <form className="card settings" onSubmit={submit}>
      <h2>管理员密码</h2>
      <div className="row">
        <div className="row-label">原密码</div>
        <div className="row-input">
          <input type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="row-label">新密码</div>
        <div className="row-input">
          <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="row-help">至少 10 个字符;修改后不再使用服务器 .env 里的 LIFELOG_ADMIN_PASSWORD</div>
        </div>
      </div>
      <div className="savebar">
        {msg && <span className={msg.ok ? 'muted' : 'error'}>{msg.text}</span>}
        <button disabled={!old || next.length < 10}>修改密码</button>
      </div>
    </form>
  )
}

function RunsTab({ guard, initial }: { guard: Guard; initial: number | null }) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [selected, setSelected] = useState<number | null>(initial)
  const [detail, setDetail] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(() => {
    api<{ runs: Run[] }>('runs')
      .then((r) => {
        setRuns(r.runs)
        setSelected((cur) => cur ?? r.runs[0]?.id ?? null)
      })
      .catch(guard)
      .catch((e: Error) => setError(e.message))
  }, [guard])
  useEffect(loadList, [loadList])

  useEffect(() => {
    if (selected === null) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const poll = () =>
      api<Run>(`runs/${selected}`)
        .then((r) => {
          if (stop) return
          setDetail(r)
          if (r.status === 'running') timer = setTimeout(poll, 1500)
          else loadList() // refresh statuses once it ends
        })
        .catch(guard)
        .catch((e: Error) => setError(e.message))
    poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [selected, guard, loadList])

  if (!runs) return error ? <p className="error">{error}</p> : <p className="muted">加载中…</p>
  if (runs.length === 0) return <p className="muted">还没有同步记录</p>
  return (
    <div className="runs">
      <ul className="card run-list">
        {runs.map((r) => (
          <li key={r.id}>
            <button className={r.id === selected ? 'run active' : 'run'} onClick={() => setSelected(r.id)}>
              <span className={'dot ' + r.status} title={STATUS_LABEL[r.status]} />
              <span className="run-title">
                #{r.id} {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                {r.sources && <span className="muted"> · {r.sources}</span>}
              </span>
              <span className="muted small">{fmtTime(r.started_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      <section className="card run-detail">
        {detail && detail.id === selected ? (
          <>
            <header>
              <h2>
                #{detail.id} {TRIGGER_LABEL[detail.trigger] ?? detail.trigger}
              </h2>
              <span className={'badge ' + detail.status}>{STATUS_LABEL[detail.status]}</span>
              <span className="muted small">
                {fmtTime(detail.started_at)}
                {detail.finished_at && ` · 用时 ${Math.max(1, Math.round((+new Date(detail.finished_at) - +new Date(detail.started_at)) / 1000))} 秒`}
              </span>
            </header>
            <pre className="log">{detail.log || '(没有输出)'}</pre>
          </>
        ) : (
          <p className="muted">加载中…</p>
        )}
      </section>
    </div>
  )
}
