import { useState } from 'react'
import type { SpotifyTop as Top } from '../types'
import { load, save, useI18n } from '../i18n'

const RANGES = ['short_term', 'medium_term', 'long_term'] as const
type Range = (typeof RANGES)[number]
const STEP = 10

/** Spotify's own top artists and songs over its rolling windows (not the year filter). */
export function SpotifyTop({ top }: { top: Top }) {
  const { t, lang } = useI18n()
  const [range, setRangeState] = useState<Range>(() => {
    const saved = load('spotifyRange')
    return (RANGES as readonly string[]).includes(saved ?? '') ? (saved as Range) : 'short_term'
  })
  const setRange = (r: Range) => {
    setRangeState(r)
    save('spotifyRange', r)
  }
  const [shown, setShown] = useState(STEP)
  const lists = top.ranges[range] ?? { artists: [], tracks: [] }
  const label = { short_term: t.range4w, medium_term: t.range6m, long_term: t.range1y }

  return (
    <section className="panel spotify-top">
      <header className="panel-head">
        <h3>
          <span className="swatch" style={{ background: 'var(--c-spotify)' }} />
          {t.spotifyTop}
          <span className="hint" title={t.spotifyTopNote}>
            ⓘ
          </span>
        </h3>
        <div className="seg seg-sm" role="group">
          {RANGES.map((r) => (
            <button key={r} className={r === range ? 'on' : ''} aria-pressed={r === range} onClick={() => setRange(r)}>
              {label[r]}
            </button>
          ))}
        </div>
      </header>
      <div className="top-cols">
        <div>
          <h4>{t.topArtists}</h4>
          <ol className="top-list">
            {lists.artists.slice(0, shown).map((a, i) => (
              <li key={a.id}>
                <span className="top-rank">{i + 1}</span>
                {a.image ? <img src={a.image} alt="" className="round" loading="lazy" /> : <span className="img-ph round" />}
                <span className="top-text">
                  <b>{a.name}</b>
                  {a.genres?.length ? <small>{a.genres.slice(0, 2).join(' · ')}</small> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4>{t.topTracks}</h4>
          <ol className="top-list">
            {lists.tracks.slice(0, shown).map((s, i) => (
              <li key={s.id}>
                <span className="top-rank">{i + 1}</span>
                {s.image ? <img src={s.image} alt="" loading="lazy" /> : <span className="img-ph" />}
                <span className="top-text">
                  <b>{s.name}</b>
                  <small>{s.artist}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {shown < Math.max(lists.artists.length, lists.tracks.length) && (
        <button className="more" onClick={() => setShown(shown + STEP)}>
          {t.showMore}
        </button>
      )}
      <p className="music-note">
        {t.spotifyUpdated(new Date(top.updated_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'))}
      </p>
    </section>
  )
}
