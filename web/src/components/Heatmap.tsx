import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Category, Data } from '../types'
import { addDays, fmtNum, isoDate } from '../lib/format'

const CELL = 11
const GAP = 2
const STEP = CELL + GAP
const LEFT = 22
const TOP = 16
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
// color-mix percentage of the category color per intensity level (one-hue ramp)
const LEVEL_MIX = [0, 28, 52, 76, 100]

interface Props {
  year: number
  category: Category
  daily: Data['daily']
}

interface Cell {
  date: string
  week: number
  dow: number // 0 = Monday
  value: number
  level: number
}

export function Heatmap({ year, category, daily }: Props) {
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { cells, weeks, total, activeDays, streak } = useMemo(() => {
    const jan1 = new Date(year, 0, 1)
    const offset = (jan1.getDay() + 6) % 7
    const today = isoDate(new Date())
    const cells: Cell[] = []
    for (let d = jan1, i = 0; d.getFullYear() === year; d = addDays(d, 1), i++) {
      const date = isoDate(d)
      if (date > today) break
      const value = (daily[date]?.[category.metric] ?? 0) * category.scale
      cells.push({ date, week: Math.floor((i + offset) / 7), dow: (d.getDay() + 6) % 7, value, level: 0 })
    }
    // Quartiles of the non-zero days pick the 4 intensity levels, so one huge
    // day does not wash out the rest of the year.
    const nz = cells.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b)
    const q = [0.25, 0.5, 0.75].map((p) => nz[Math.floor(p * (nz.length - 1))] ?? 0)
    for (const c of cells) {
      if (c.value <= 0) continue
      c.level = c.value <= q[0] ? 1 : c.value <= q[1] ? 2 : c.value <= q[2] ? 3 : 4
    }
    let streak = 0
    if (year === new Date().getFullYear()) {
      let i = cells.length - 1
      if (i >= 0 && cells[i].value === 0) i-- // today not logged yet doesn't break the streak
      while (i >= 0 && cells[i].value > 0) {
        streak++
        i--
      }
    }
    return {
      cells,
      weeks: Math.floor((offset + 365) / 7) + 1,
      total: nz.reduce((a, b) => a + b, 0),
      activeDays: nz.length,
      streak,
    }
  }, [year, category, daily])

  const byPos = useMemo(() => {
    const m = new Map<string, Cell>()
    for (const c of cells) m.set(`${c.week}:${c.dow}`, c)
    return m
  }, [cells])

  // On narrow screens start scrolled to the most recent weeks.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [year])

  const width = LEFT + weeks * STEP
  const height = TOP + 7 * STEP

  // One handler on the whole grid: the hit target is the full step, not just the cell.
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = width / rect.width
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sx
    const cell = byPos.get(`${Math.floor((x - LEFT) / STEP)}:${Math.floor((y - TOP) / STEP)}`)
    if (!cell) return setTip(null)
    setTip({ cell, x: LEFT + cell.week * STEP + CELL / 2, y: TOP + cell.dow * STEP })
  }

  const monthLabels = MONTHS.map((label, m) => {
    const first = cells.find((c) => Number(c.date.slice(5, 7)) === m + 1)
    return first ? { label, x: LEFT + first.week * STEP } : null
  })

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: category.color }} />
          {category.label}
        </h3>
        <dl className="stats">
          <div>
            <dt>{year} 合计</dt>
            <dd>
              {fmtNum(total)} <small>{category.unit}</small>
            </dd>
          </div>
          <div>
            <dt>活跃天数</dt>
            <dd>{activeDays}</dd>
          </div>
          {year === new Date().getFullYear() && (
            <div>
              <dt>连续</dt>
              <dd>
                {streak} <small>天</small>
              </dd>
            </div>
          )}
        </dl>
      </header>
      <div className="heatmap-scroll" ref={scrollRef}>
        <div className="heatmap" style={{ width }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            onMouseMove={onMove}
            onMouseLeave={() => setTip(null)}
            role="img"
            aria-label={`${year} 年${category.label}每日热力图,合计 ${fmtNum(total)} ${category.unit}`}
          >
            {monthLabels.map(
              (m) =>
                m && (
                  <text key={m.label} x={m.x} y={10} className="axis-label">
                    {m.label}
                  </text>
                ),
            )}
            {['一', '三', '五'].map((d, i) => (
              <text key={d} x={0} y={TOP + (i * 2) * STEP + CELL - 2} className="axis-label">
                {d}
              </text>
            ))}
            {cells.map((c) => (
              <rect
                key={c.date}
                x={LEFT + c.week * STEP}
                y={TOP + c.dow * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                fill={
                  c.level === 0
                    ? 'var(--cell-empty)'
                    : `color-mix(in oklab, ${category.color} ${LEVEL_MIX[c.level]}%, var(--surface))`
                }
                stroke={tip?.cell === c ? 'var(--text-primary)' : 'none'}
                strokeWidth={1.5}
              />
            ))}
          </svg>
          {tip && (
            <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
              <strong>{tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${category.unit}` : '无记录'}</strong>
              <span>{tip.cell.date}</span>
            </div>
          )}
        </div>
      </div>
      <div className="scale" aria-hidden>
        少
        {LEVEL_MIX.map((mix, i) => (
          <i
            key={i}
            style={{
              background: i === 0 ? 'var(--cell-empty)' : `color-mix(in oklab, ${category.color} ${mix}%, var(--surface))`,
            }}
          />
        ))}
        多
      </div>
    </section>
  )
}
