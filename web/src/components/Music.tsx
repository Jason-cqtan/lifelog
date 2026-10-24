import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { MusicStats } from '../types'
import { useI18n, type Dict } from '../i18n'
import { fmtNum } from '../lib/format'
import { Scale, Tooltip, levelFill, quartileLevels, toViewport } from './heat'

const COLOR = 'var(--c-spotify)'
const LIST_STEP = 20

function minutes(ms: number, t: Dict): string {
  const m = Math.round(ms / 60000)
  return m >= 60 ? t.duration(Math.floor(m / 60), m % 60) : t.duration(0, m)
}

/** Listening detail for one period: totals, when you listen, top artists and songs. */
export function Music({ stats }: { stats: MusicStats }) {
  const { t } = useI18n()
  return (
    <div className="music">
      <div className="music-tiles">
        <Tile label={t.musicTime} value={fmtNum(stats.ms / 3600000)} unit={t.hoursUnit} />
        <Tile label={t.musicPlays} value={fmtNum(stats.plays, 0)} />
        <Tile label={t.musicArtists} value={fmtNum(stats.artists, 0)} />
        <Tile label={t.musicTracks} value={fmtNum(stats.tracks, 0)} />
      </div>
      <HourGrid hours={stats.hours} />
      <div className="music-lists">
        <Artists stats={stats} />
        <Tracks stats={stats} />
      </div>
      <p className="music-note">{t.musicNote}</p>
    </div>
  )
}

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="music-tile">
      <span className="pb-label">{label}</span>
      <span className="pb-time">
        {value} {unit && <small>{unit}</small>}
      </span>
    </div>
  )
}

const CW = 22
const CH = 18
const GAP = 3
const LEFT = 30
const TOP = 16

/** Weekday × hour heatmap of listening time. */
function HourGrid({ hours }: { hours: number[][] }) {
  const { t } = useI18n()
  const [tip, setTip] = useState<{ d: number; h: number; x: number; y: number } | null>(null)
  const clearTip = useCallback(() => setTip(null), [])
  const level = useMemo(() => quartileLevels(hours.flat()), [hours])
  const peak = useMemo(() => {
    const byHour = Array.from({ length: 24 }, (_, h) => hours.reduce((s, row) => s + row[h], 0))
    const max = Math.max(...byHour)
    return max > 0 ? byHour.indexOf(max) : null
  }, [hours])

  const width = LEFT + 24 * (CW + GAP)
  const height = TOP + 7 * (CH + GAP)
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = width / r.width
    const h = Math.floor(((e.clientX - r.left) * s - LEFT) / (CW + GAP))
    const d = Math.floor(((e.clientY - r.top) * s - TOP) / (CH + GAP))
    if (h < 0 || h > 23 || d < 0 || d > 6) return setTip(null)
    setTip({ d, h, ...toViewport(e.currentTarget, width, LEFT + h * (CW + GAP) + CW / 2, TOP + d * (CH + GAP)) })
  }
  const span = (h: number) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`

  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: COLOR }} />
          {t.whenListen}
        </h3>
        {peak !== null && (
          <dl className="stats">
            <div>
              <dt>{t.peakHour}</dt>
              <dd>{span(peak)}</dd>
            </div>
          </dl>
        )}
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
            aria-label={t.whenListen}
          >
            {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => (
              <text key={h} x={LEFT + h * (CW + GAP)} y={10} className="axis-label">
                {h}
              </text>
            ))}
            {t.weekdaysAll.map((d, i) => (
              <text key={d} x={0} y={TOP + i * (CH + GAP) + CH - 5} className="axis-label">
                {d}
              </text>
            ))}
            {hours.map((row, d) =>
              row.map((ms, h) => (
                <rect
                  key={`${d}-${h}`}
                  x={LEFT + h * (CW + GAP)}
                  y={TOP + d * (CH + GAP)}
                  width={CW}
                  height={CH}
                  rx={3}
                  fill={levelFill(COLOR, level(ms))}
                  stroke={tip?.d === d && tip?.h === h ? 'var(--text-primary)' : 'none'}
                  strokeWidth={1.5}
                />
              )),
            )}
          </svg>
          {tip && (
            <Tooltip x={tip.x} y={tip.y} onScroll={clearTip}>
              <strong>{hours[tip.d][tip.h] > 0 ? minutes(hours[tip.d][tip.h], t) : t.noRecord}</strong>
              <span>
                {t.weekdaysAll[tip.d]} {span(tip.h)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="heat-foot">
        <Scale color={COLOR} />
      </div>
    </section>
  )
}

function Artists({ stats }: { stats: MusicStats }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(LIST_STEP)
  const max = stats.top_artists[0]?.ms ?? 1
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: COLOR }} />
          {t.topArtists}
        </h3>
      </header>
      <table className="rank">
        <thead>
          <tr>
            <th>#</th>
            <th>{t.artist}</th>
            <th className="num">{t.listenTime}</th>
            <th className="num">{t.plays}</th>
            <th className="num">{t.songs}</th>
          </tr>
        </thead>
        <tbody>
          {stats.top_artists.slice(0, shown).map((a, i) => (
            <tr key={a.name}>
              <td className="muted">{i + 1}</td>
              <td className="rank-name">
                <span>{a.name}</span>
                {/* share of the top artist's time; the number beside it carries the value */}
                <i className="rank-bar" style={{ width: `${(a.ms / max) * 100}%` }} aria-hidden />
              </td>
              <td className="num">{minutes(a.ms, t)}</td>
              <td className="num">{a.plays}</td>
              <td className="num">{a.tracks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < stats.top_artists.length && (
        <button className="more" onClick={() => setShown(shown + LIST_STEP)}>
          {t.loadMore(stats.top_artists.length - shown)}
        </button>
      )}
    </section>
  )
}

function Tracks({ stats }: { stats: MusicStats }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(LIST_STEP)
  const [by, setBy] = useState<'plays' | 'ms'>('plays')
  const list = useMemo(
    () => [...stats.top_tracks].sort((a, b) => (by === 'plays' ? b.plays - a.plays || b.ms - a.ms : b.ms - a.ms || b.plays - a.plays)),
    [stats, by],
  )
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: COLOR }} />
          {t.topTracks}
        </h3>
        <div className="seg seg-sm" role="group">
          {(['plays', 'ms'] as const).map((k) => (
            <button key={k} className={by === k ? 'on' : ''} aria-pressed={by === k} onClick={() => setBy(k)}>
              {k === 'plays' ? t.byPlays : t.byTime}
            </button>
          ))}
        </div>
      </header>
      <table className="rank">
        <thead>
          <tr>
            <th>#</th>
            <th>{t.song}</th>
            <th className="num">{t.plays}</th>
            <th className="num">{t.listenTime}</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, shown).map((s, i) => (
            <tr key={`${s.track}|${s.artist}`}>
              <td className="muted">{i + 1}</td>
              <td className="rank-name">
                <span>{s.track}</span>
                <small>{s.artist}</small>
              </td>
              <td className="num">{s.plays}</td>
              <td className="num">{minutes(s.ms, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < list.length && (
        <button className="more" onClick={() => setShown(shown + LIST_STEP)}>
          {t.loadMore(list.length - shown)}
        </button>
      )}
    </section>
  )
}
