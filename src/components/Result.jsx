import { useState } from 'react'
import { formatPercent } from '../lib/sync'

const ABS_URL = import.meta.env.VITE_ABS_URL || ''

/**
 * Open Audiobookshelf's web player on this book. It resumes from the position
 * we just set, so it's one tap to Play at the synced spot.
 *
 * Audiobookshelf has no auto-play URL and its native app can't be deep-linked
 * to a book (its scheme is OAuth-only), so this opens the web player. It's an
 * http:// link on the tailnet; opening it in a NEW TAB from this HTTPS page is
 * allowed (mixed-content only blocks subresources, not a top-level navigation).
 * The device must be on the tailnet and signed into ABS web once.
 */
function OpenInAbs({ itemId }) {
  if (!ABS_URL) return null
  const url = `${ABS_URL.replace(/\/$/, '')}/item/${itemId}`
  return (
    <>
      <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
        ▶ Open in Audiobookshelf
      </a>
      <p className="hint">
        Opens the book at your synced spot — tap Play to start from there.
      </p>
    </>
  )
}

/** The reverse direction: where am I now, as a phrase to search on the Kindle. */
function ResumeResult({ r }) {
  const [copied, setCopied] = useState(false)
  const phrase = r.kindle_phrase || ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked -- the phrase is on screen to type by hand */
    }
  }

  return (
    <div className="card">
      <div className="card-title">Continue on Kindle</div>
      <p className="hint">
        You're in {r.chapter ? <strong>{r.chapter}</strong> : 'the book'}
        {' '}(~{formatPercent(r.text_percent)}), from {r.from || 'your devices'}.
      </p>

      <p className="label">Search this on your Kindle</p>
      <button type="button" className="phrase" onClick={copy} title="Tap to copy">
        {phrase || '—'}
      </button>
      <p className="hint">
        {copied ? 'Copied. ' : 'Tap the phrase to copy. '}
        Open the book on the Kindle, tap search, paste, and tap the result.
      </p>
    </div>
  )
}

/**
 * What happened, and how to actually get to the spot.
 *
 * The manual card is not a fallback for errors -- it is the primary path
 * whenever the X4 has no Wi-Fi, which is often. The device can only be
 * navigated by its table of contents and a go-to-percent slider, so those are
 * exactly what we show, plus a line of text to confirm you landed right.
 *
 * The percentage shown for the device is deliberately `percent_device`, not
 * `text_percent`. The X4's slider runs on its own byte-weighted ruler, and on a
 * markup-heavy book the two differ by a fifth of the book.
 */
export function Result({ row, book, onReset }) {
  const r = row.result || {}
  const ok = row.status === 'done'
  const pushed = Array.isArray(r.pushed) ? r.pushed : []
  const isResume = 'kindle_phrase' in r || row.anchor_type === 'resume'

  return (
    <>
      {ok && isResume && <ResumeResult r={r} />}

      {!ok && (
        <div className="card error">
          <div className="card-title">
            {row.status === 'not_found' && 'Could not find those words'}
            {row.status === 'timeout' && 'No answer from the Beelink'}
            {row.status === 'failed' && 'Something went wrong'}
            {row.status === 'ambiguous' && 'Too many matches'}
          </div>
          <p className="muted">
            {row.detail ||
              'Try a longer or more distinctive phrase, and check for typos.'}
          </p>
        </div>
      )}

      {ok && !isResume && (
        <>
          <div className="card">
            <div className="card-title">Found it</div>
            <div className="place">
              {r.chapter && <div className="chapter">{r.chapter}</div>}
              <div className="pcts">
                <span className="pct">{formatPercent(r.text_percent)}</span>
                <span className="muted"> through the book</span>
              </div>
            </div>
            {r.quote && <p className="quote">“{r.quote}…”</p>}
            {r.occurrences > 1 && (
              <p className="hint">
                Those words appear {r.occurrences} times. Picked the one nearest
                where you last were.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              On the X4
              {pushed.includes('x4') && <span className="badge">sent</span>}
            </div>

            <ol className="steps">
              <li>
                <strong>With Wi-Fi:</strong> open the book, then Reader Menu →
                Sync&nbsp;Progress. It will jump here.
              </li>
              <li>
                <strong>Without Wi-Fi:</strong> Reader Menu → Go&nbsp;to&nbsp;Percent,
                set it to <strong>{Math.round((r.percent_device ?? 0) * 100)}%</strong>
                {r.chapter && <> (or pick <strong>{r.chapter}</strong> from the contents)</>},
                then page until you reach the line above.
              </li>
            </ol>

            <p className="hint">
              The X4 only syncs when you ask it to — it keeps Wi-Fi off the rest
              of the time.
            </p>

            {r.warning && <div className="warn">{r.warning}</div>}
          </div>

          {r.abs && (
            <div className="card">
              <div className="card-title">Audiobook</div>
              <p className="muted">{r.abs}</p>
              {r.abs_item_id && <OpenInAbs itemId={r.abs_item_id} />}
            </div>
          )}

          {r.alternatives?.length > 0 && (
            <div className="card">
              <div className="card-title">Other matches</div>
              <ul className="alts">
                {r.alternatives.map((a, i) => (
                  <li key={i}>
                    <span className="pct-sm">{formatPercent(a.text_percent)}</span>
                    <span className="muted"> …{a.context}…</span>
                  </li>
                ))}
              </ul>
              <p className="hint">
                Wrong one? Type a few more words to narrow it down.
              </p>
            </div>
          )}
        </>
      )}

      <button className="btn ghost" onClick={onReset}>
        Look up another spot
      </button>
    </>
  )
}
