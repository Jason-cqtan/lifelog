import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, type Data } from './types'
import { Heatmap } from './components/Heatmap'
import { ActivityList } from './components/ActivityList'

export function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    // GitHub Pages caches files for 10 min; revalidate so a fresh sync shows up at once.
    fetch(import.meta.env.BASE_URL + 'data.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  const years = useMemo(() => {
    if (!data) return []
    const ys = new Set<number>([new Date().getFullYear()])
    for (const d of Object.keys(data.daily)) ys.add(Number(d.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [data])

  if (error) {
    return (
      <main className="page">
        <p className="empty">
          读取 data.json 失败({error})。先运行 <code>go run ./cmd/lifelog export</code>,或用{' '}
          <code>-demo</code> 生成示例数据。
        </p>
      </main>
    )
  }
  if (!data) return <main className="page" />

  const yearActivities = data.activities.filter((a) => a.date.startsWith(String(year)))

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Lifelog</h1>
          <p className="sub">
            运动 · 学习 · 音乐 · 代码 —— 更新于 {new Date(data.generated_at).toLocaleString('zh-CN')}
          </p>
        </div>
        <nav className="years">
          {years.map((y) => (
            <button key={y} className={y === year ? 'on' : ''} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </nav>
      </header>

      <div className="panels">
        {CATEGORIES.map((c) => (
          <Heatmap key={c.key} year={year} category={c} daily={data.daily} />
        ))}
      </div>

      <ActivityList key={year} activities={yearActivities} />
    </main>
  )
}
