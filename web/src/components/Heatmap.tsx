import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Category, Data } from '../types'
import { addDays, fmtNum, isoDate } from '../lib/format'
import { useI18n } from '../i18n'
import { Scale, levelFill, quartileLevels } from './heat'

const CELL = 11
const GAP = 2
const STEP = CELL + GAP
const LEFT = 26
const TOP = 16

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
  const { lang, t } = useI18n()
  const label = category.label[lang]
  const unit = category.unit[lang]
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { cells, weeks, total, activeDays, goalDays, streak } = useMemo(() => {
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
    const level = quartileLevels(cells.map((c) => c.value))
    for (const c of cells) c.level = level(c.value)
    const nz = cells.map((c) => c.value).filter((v) => v > 0)
    const goalDays = category.goalMetric
      ? cells.filter((c) => {
          const goal = daily[c.date]?.[category.goalMetric!] ?? 0
          return goal > 0 && c.value >= goal * category.scale
        }).length
      : null
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
      goalDays,
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

  const monthLabels = t.months.map((label, m) => {
    const first = cells.find((c) => Number(c.date.slice(5, 7)) === m + 1)
    return first ? { label, x: LEFT + first.week * STEP } : null
  })

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: category.color }} />
          {label}
        </h3>
        <dl className="stats">
          <div>
            <dt>{t.yearTotal(year)}</dt>
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
          {year === new Date().getFullYear() && (
            <div>
              <dt>{t.streak}</dt>
              <dd>
                {streak} <small>{t.days}</small>
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
            aria-label={t.heatmapLabel(year, label, fmtNum(total), unit)}
          >
            {monthLabels.map(
              (m) =>
                m && (
                  <text key={m.label} x={m.x} y={10} className="axis-label">
                    {m.label}
                  </text>
                ),
            )}
            {t.weekdays.map((d, i) => (
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
                fill={levelFill(category.color, c.level)}
                stroke={tip?.cell === c ? 'var(--text-primary)' : 'none'}
                strokeWidth={1.5}
              />
            ))}
          </svg>
          {tip && (
            <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
              <strong>{tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${unit}` : t.noRecord}</strong>
              <span>{tip.cell.date}</span>
            </div>
          )}
        </div>
      </div>
      <Scale color={category.color} />
    </section>
  )
}
