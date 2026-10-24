import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { Category, Data } from '../types'
import { fmtNum } from '../lib/format'
import { useI18n } from '../i18n'
import { Scale, Tooltip, levelFill, quartileLevels, toViewport } from './heat'

// All-time view: one row per year, one cell per month (the monthly total).
const CW = 40
const CH = 18
const GAP = 3
const LEFT = 40
const TOP = 16

interface Props {
  category: Category
  daily: Data['daily']
}

interface Cell {
  year: number
  month: number // 0-11
  value: number
  days: number
  level: number
}

export function Overview({ category, daily }: Props) {
  const { lang, t } = useI18n()
  const label = category.label[lang]
  const unit = category.unit[lang]
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number } | null>(null)
  const clearTip = useCallback(() => setTip(null), [])

  const { cells, years, total, activeDays, goalDays, longest } = useMemo(() => {
    const byMonth = new Map<string, { value: number; days: number }>()
    const activeDates: string[] = []
    let goalDays = 0
    for (const [date, m] of Object.entries(daily)) {
      const v = (m[category.metric] ?? 0) * category.scale
      if (v <= 0) continue
      activeDates.push(date)
      const key = date.slice(0, 7)
      const cur = byMonth.get(key) ?? { value: 0, days: 0 }
      byMonth.set(key, { value: cur.value + v, days: cur.days + 1 })
      const goal = category.goalMetric ? (m[category.goalMetric] ?? 0) : 0
      if (goal > 0 && v >= goal * category.scale) goalDays++
    }
    activeDates.sort()

    // Longest run of consecutive calendar days with data.
    let longest = 0
    let run = 0
    let prev = 0
    for (const d of activeDates) {
      const day = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000
      run = day - prev === 1 ? run + 1 : 1
      prev = day
      longest = Math.max(longest, run)
    }

    const first = Number(activeDates[0]?.slice(0, 4) ?? new Date().getFullYear())
    const last = Number(activeDates[activeDates.length - 1]?.slice(0, 4) ?? first)
    const now = new Date()
    const years: number[] = []
    for (let y = last; y >= first; y--) years.push(y) // newest on top, gaps kept
    const cells: Cell[] = []
    for (const y of years) {
      for (let m = 0; m < 12; m++) {
        if (y === now.getFullYear() && m > now.getMonth()) break
        const e = byMonth.get(`${y}-${String(m + 1).padStart(2, '0')}`)
        cells.push({ year: y, month: m, value: e?.value ?? 0, days: e?.days ?? 0, level: 0 })
      }
    }
    const level = quartileLevels(cells.map((c) => c.value))
    for (const c of cells) c.level = level(c.value)

    return {
      cells,
      years,
      total: cells.reduce((a, c) => a + c.value, 0),
      activeDays: activeDates.length,
      goalDays: category.goalMetric ? goalDays : null,
      longest,
    }
  }, [category, daily])

  const width = LEFT + 12 * (CW + GAP)
  const height = TOP + years.length * (CH + GAP)
  const row = (y: number) => years.indexOf(y)

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const s = width / rect.width
    const col = Math.floor(((e.clientX - rect.left) * s - LEFT) / (CW + GAP))
    const r = Math.floor(((e.clientY - rect.top) * s - TOP) / (CH + GAP))
    const cell = cells.find((c) => c.month === col && row(c.year) === r)
    if (!cell) return setTip(null)
    setTip({ cell, ...toViewport(e.currentTarget, width, LEFT + col * (CW + GAP) + CW / 2, TOP + r * (CH + GAP)) })
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: category.color }} />
          {label}
        </h3>
        <dl className="stats">
          <div>
            <dt>{t.allTime}</dt>
            <dd>
              {fmtNum(total)} <small>{unit}</small>
            </dd>
          </div>
          <div>
            <dt>{t.activeDays}</dt>
            <dd>{activeDays}</dd>
          </div>
          {goalDays !== null && (
            <div>
              <dt>{t.goalDays}</dt>
              <dd>{goalDays}</dd>
            </div>
          )}
          <div>
            <dt>{t.longestStreak}</dt>
            <dd>
              {longest} <small>{t.days}</small>
            </dd>
          </div>
        </dl>
      </header>
      <div className="heatmap-scroll">
        <div className="heatmap" style={{ width }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            onMouseMove={onMove}
            onMouseLeave={clearTip}
            role="img"
            aria-label={t.overviewLabel(label, fmtNum(total), unit)}
          >
            {t.months.map((m, i) => (
              <text key={m} x={LEFT + i * (CW + GAP)} y={10} className="axis-label">
                {m}
              </text>
            ))}
            {years.map((y, i) => (
              <text key={y} x={0} y={TOP + i * (CH + GAP) + CH - 5} className="axis-label">
                {y}
              </text>
            ))}
            {cells.map((c) => (
              <rect
                key={`${c.year}-${c.month}`}
                x={LEFT + c.month * (CW + GAP)}
                y={TOP + row(c.year) * (CH + GAP)}
                width={CW}
                height={CH}
                rx={3}
                fill={levelFill(category.color, c.level)}
                stroke={tip?.cell === c ? 'var(--text-primary)' : 'none'}
                strokeWidth={1.5}
              />
            ))}
          </svg>
          {tip && (
            <Tooltip x={tip.x} y={tip.y} onScroll={clearTip}>
              <strong>{tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${unit}` : t.noRecord}</strong>
              <span>
                {tip.cell.year}-{String(tip.cell.month + 1).padStart(2, '0')}
                {tip.cell.days > 0 && ` · ${t.activeIn(tip.cell.days)}`}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <Scale color={category.color} />
    </section>
  )
}
