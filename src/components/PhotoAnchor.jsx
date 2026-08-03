import { useRef, useState } from 'react'
import { defaultLine, readPage } from '../lib/vision'

/**
 * Take a photo of the Kindle page instead of typing the words.
 *
 * The photo is not the anchor — a line off the page is. So the flow is: shoot,
 * read, then confirm which line you stopped on. It guesses the last line of the
 * page (the usual case: you finish a page, then stop), and every other line
 * stays one tap away, because a wrong guess here sends the whole stack to the
 * wrong chapter.
 *
 * Lifts the chosen line into the parent's anchor value, so submitting is the
 * same path as a typed phrase.
 */
export function PhotoAnchor({ value, onChange, disabled }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(null)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    // Let the same photo be re-picked after a retry.
    e.target.value = ''
    if (!file) return

    setBusy(true)
    setError(null)
    setPage(null)
    onChange('')
    try {
      const read = await readPage(file)
      setPage(read)
      setShowAll(false)
      onChange(defaultLine(read))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const lines = page ? (showAll ? page.lines : page.usable) : []

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={pick}
        hidden
      />

      <button
        type="button"
        className={page ? 'btn ghost' : 'btn'}
        onClick={() => fileRef.current?.click()}
        disabled={busy || disabled}
      >
        {busy ? 'reading the page…' : page ? 'Take another photo' : 'Photograph the page'}
      </button>

      {!page && !busy && !error && (
        <p className="hint">
          Point the camera at the Kindle page you stopped on. Fill the frame,
          keep it flat, and avoid glare on the screen.
        </p>
      )}

      {error && <div className="error-text">{error}</div>}

      {page && (
        <div className="page-read">
          {page.thumbnail && (
            <img className="shot" src={page.thumbnail} alt="The page you photographed" />
          )}

          {page.chapter && <p className="hint">Looks like {page.chapter}.</p>}

          <p className="label">Which line did you stop on?</p>
          <ul className="lines">
            {lines.map((line, i) => (
              <li key={`${i}-${line}`}>
                <button
                  type="button"
                  className={line === value ? 'line on' : 'line'}
                  onClick={() => onChange(line)}
                  aria-pressed={line === value}
                >
                  {line}
                </button>
              </li>
            ))}
          </ul>

          <p className="hint">
            Picked the last line of the page. Tap a different one if you stopped
            higher up.
          </p>

          {page.lines.length > page.usable.length && (
            <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? 'hide the short lines'
                : `show ${page.lines.length - page.usable.length} short line${
                    page.lines.length - page.usable.length === 1 ? '' : 's'
                  }`}
            </button>
          )}
          {showAll && (
            <p className="hint">
              Short lines match in too many places to find on their own — pick a
              longer one nearby instead.
            </p>
          )}
        </div>
      )}
    </>
  )
}
