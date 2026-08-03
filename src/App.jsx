import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  awaitResult,
  formatPercent,
  lastPositionFor,
  listBooks,
  rememberPosition,
  requestResume,
  submitAnchor,
} from './lib/sync'
import { Result } from './components/Result'
import { PhotoAnchor } from './components/PhotoAnchor'

const MODES = {
  photo: {
    label: 'Photo',
    // Resolves to a line of text like any other phrase -- the camera only
    // replaces the typing, not the lookup.
    hint: '',
    placeholder: '',
    inputMode: 'text',
  },
  phrase: {
    label: 'A few words',
    hint: 'Type 4-5 words from where you stopped. Fewer works, but 4-5 is almost always unique.',
    placeholder: 'i turn on the helmet radio',
    inputMode: 'text',
  },
  percent: {
    label: 'Percent',
    hint: 'The percentage shown on the Kindle. Less precise -- lands you within a few pages.',
    placeholder: '43',
    inputMode: 'decimal',
  },
}

export default function App() {
  const [books, setBooks] = useState([])
  const [bookKey, setBookKey] = useState('')
  // Two directions: 'save' pushes where I stopped OUT to the devices;
  // 'resume' pulls my current spot IN as a phrase to search on the Kindle.
  const [flow, setFlow] = useState('save')
  // Photo first: it is the whole point of the app to make "where did I stop"
  // cost nothing, and the camera is cheaper than the keyboard. The typed modes
  // stay one tap away for when there is no page in front of you.
  const [mode, setMode] = useState('photo')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  useEffect(() => {
    listBooks()
      .then((rows) => {
        setBooks(rows)
        setBookKey((k) => k || localStorage.getItem('place_last_book') || rows[0]?.book_key || '')
      })
      .catch((e) => setLoadErr(e.message))
  }, [])

  useEffect(() => {
    if (bookKey) localStorage.setItem('place_last_book', bookKey)
  }, [bookKey])

  const book = books.find((b) => b.book_key === bookKey)
  const near = bookKey ? lastPositionFor(bookKey) : null

  /** One round trip: submit an anchor, wait for the box, show the answer. */
  const run = async (make) => {
    if (!bookKey || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const row = await make()
      const done = await awaitResult(row.id)
      setResult(done)
      if (done.status === 'done' && typeof done.result?.text_percent === 'number') {
        // Feeds proximity disambiguation on the next lookup.
        rememberPosition(bookKey, done.result.text_percent)
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (flow === 'save' && !value.trim()) return
    run(() =>
      flow === 'resume'
        ? requestResume({ bookKey, bookTitle: book?.title || bookKey })
        : submitAnchor({
            bookKey,
            bookTitle: book?.title || bookKey,
            // A photo resolves to a line of the book, so the box sees exactly
            // what a typed phrase produces. Nothing server-side knows this
            // mode exists.
            anchorType: mode === 'photo' ? 'phrase' : mode,
            anchorValue: value.trim(),
          }),
    )
  }

  /**
   * Retry with a phrase the box suggested after a near-miss. Its wording comes
   * from the book itself, so this second pass is always an exact hit. The input
   * is updated too, so what ran is what you see.
   */
  const useSuggestion = (phrase) => {
    setMode('phrase')
    setValue(phrase)
    run(() =>
      submitAnchor({
        bookKey,
        bookTitle: book?.title || bookKey,
        anchorType: 'phrase',
        anchorValue: phrase,
      }),
    )
  }

  const reset = () => {
    setResult(null)
    setValue('')
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">place</div>
        <button
          className="link"
          onClick={() => supabase.auth.signOut()}
          title="Sign out"
        >
          sign out
        </button>
      </header>

      <main className="col">
        {loadErr && (
          <div className="card error">
            <div className="card-title">Could not load your library</div>
            <p className="muted">{loadErr}</p>
          </div>
        )}

        {!result && (
          <form className="card" onSubmit={submit}>
            <div className="segmented flows" role="tablist">
              <button
                type="button" role="tab" aria-selected={flow === 'save'}
                className={flow === 'save' ? 'seg on' : 'seg'}
                onClick={() => setFlow('save')}
              >
                I stopped here
              </button>
              <button
                type="button" role="tab" aria-selected={flow === 'resume'}
                className={flow === 'resume' ? 'seg on' : 'seg'}
                onClick={() => setFlow('resume')}
              >
                Continue on Kindle
              </button>
            </div>

            <label className="label" htmlFor="book">Book</label>
            <select
              id="book"
              className="input"
              value={bookKey}
              onChange={(e) => setBookKey(e.target.value)}
            >
              {books.length === 0 && <option value="">no books yet</option>}
              {books.map((b) => (
                <option key={b.book_key} value={b.book_key}>{b.title}</option>
              ))}
            </select>

            {flow === 'save' ? (
              <>
                <div className="segmented" role="tablist">
                  {Object.entries(MODES).map(([key, m]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={mode === key}
                      className={mode === key ? 'seg on' : 'seg'}
                      onClick={() => { setMode(key); setValue('') }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {mode === 'photo' ? (
                  <PhotoAnchor value={value} onChange={setValue} disabled={busy} />
                ) : (
                  <>
                    <label className="label" htmlFor="anchor">
                      {mode === 'phrase' ? 'Where you stopped' : 'Percent shown on the Kindle'}
                    </label>
                    <input
                      id="anchor"
                      className="input"
                      value={value}
                      inputMode={MODES[mode].inputMode}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={MODES[mode].placeholder}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <p className="hint">{MODES[mode].hint}</p>
                  </>
                )}

                {near !== null && (
                  <p className="hint">
                    Last synced at {formatPercent(near)} — used to pick the right match
                    if your words appear more than once.
                  </p>
                )}
              </>
            ) : (
              <p className="hint">
                Reads where you are on the X4 and the audiobook, and gives you a
                phrase to search on the Kindle. Read or listen a bit first (and
                sync the X4) so there's a position to find.
              </p>
            )}

            <button
              className="btn" type="submit"
              disabled={busy || !bookKey || (flow === 'save' && !value.trim())}
            >
              {busy
                ? (flow === 'resume' ? 'checking…' : 'finding it…')
                : (flow === 'resume' ? 'Where am I?' : 'Find my place')}
            </button>

            {error && <div className="error-text">{error}</div>}
          </form>
        )}

        {result && (
          <Result
            row={result}
            book={book}
            onReset={reset}
            onSuggestion={useSuggestion}
          />
        )}
      </main>
    </div>
  )
}
