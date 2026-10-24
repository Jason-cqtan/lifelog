import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Category, Data, SportType } from '../types'
import { addDays, fmtNum, isoDate } from '../lib/format'
import { useI18n } from '../i18n'
import { DownloadButton, Scale, Tooltip, downloadHeatmapPng, levelFill, quartileLevels, toViewport } from './heat'
import { categoryStats } from '../lib/stats'

const CELL = 11
const GAP = 2
const STEP = CELL + GAP
const LEFT = 26
const TOP = 16

interface Props {
  year: number
  category: Category
  daily: Data['daily']
  /** sport categories: open that day's activities */
  onDrill?: (type: SportType, period: string) => void
}

interface Cell {
  date: string
  week: number
  dow: number // 0 = Monday
  value: number
  level: number
}

export function Heatmap({ year, category, daily, onDrill }: Props) {
  const { lang, t } = useI18n()
  const label = category.label[lang]
  const unit = category.unit[lang]
  const [tip, setTip] = useState<{ cell: Cell; x: number; y: number } | null>(null)
  const clearTip = useCallback(() => setTip(null), [])
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { cells, weeks } = useMemo(() => {
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
    return { cells, weeks: Math.floor((offset + 365) / 7) + 1 }
  }, [year, category, daily])
  const { total, activeDays, goalDays, longest, current } = useMemo(
    () => categoryStats(daily, category, `${year}-01-01`, `${year}-12-31`),
    [year, category, daily],
  )

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
  const cellAt = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = width / rect.width
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sx
    return byPos.get(`${Math.floor((x - LEFT) / STEP)}:${Math.floor((y - TOP) / STEP)}`)
  }
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const cell = cellAt(e)
    if (!cell) return setTip(null)
    setTip({ cell, ...toViewport(e.currentTarget, width, LEFT + cell.week * STEP + CELL / 2, TOP + cell.dow * STEP) })
  }
  const drillable = (c?: Cell) => !!c && c.value > 0 && !!category.sport && !!onDrill
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const cell = cellAt(e)
    if (cell && drillable(cell)) onDrill!(category.sport!, cell.date)
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
          <DownloadButton
            onClick={() =>
              svgRef.current &&
              downloadHeatmapPng(
                svgRef.current,
                `${label} · ${String(year)}`,
                [`${t.yearTotal(year)} ${fmtNum(total)} ${unit}`, `${t.activeDays} ${activeDays}`, goalDays !== null && `${t.goalDays} ${goalDays}`, `${t.longestStreak} ${longest} ${t.days}`]
                  .filter(Boolean)
                  .join(' · '),
                `lifelog-${category.key}-${year}.png`,
              )
            }
          />
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
          <div>
            <dt>{t.longestStreak}</dt>
            <dd>
              {longest} <small>{t.days}</small>
            </dd>
          </div>
          {year === new Date().getFullYear() && (
            <div>
              <dt>{t.streak}</dt>
              <dd>
                {current} <small>{t.days}</small>
              </dd>
            </div>
          )}
        </dl>
      </header>
      <div className="heatmap-scroll" ref={scrollRef}>
        <div className="heatmap" style={{ width }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            onMouseMove={onMove}
            onMouseLeave={clearTip}
            onClick={onClick}
            style={{ cursor: drillable(tip?.cell) ? 'pointer' : undefined }}
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
            <Tooltip x={tip.x} y={tip.y} onScroll={clearTip}>
              <strong>{tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${unit}` : t.noRecord}</strong>
              <span>{tip.cell.date}</span>
              {drillable(tip.cell) && <span className="tip-hint">{t.drillDay}</span>}
            </Tooltip>
          )}
        </div>
      </div>
      <Scale color={category.color} />
    </section>
  )
}
