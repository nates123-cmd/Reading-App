import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  awaitResult,
  formatPercent,
  lastPositionFor,
  listBooks,
  rememberPosition,
  submitAnchor,
} from './lib/sync'
import { Result } from './components/Result'

const MODES = {
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
  const [mode, setMode] = useState('phrase')
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

  const submit = async (e) => {
    e.preventDefault()
    if (!bookKey || !value.trim() || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const row = await submitAnchor({
        bookKey,
        bookTitle: book?.title || bookKey,
        anchorType: mode,
        anchorValue: value.trim(),
      })
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

            {near !== null && (
              <p className="hint">
                Last synced at {formatPercent(near)} — used to pick the right match
                if your words appear more than once.
              </p>
            )}

            <button className="btn" type="submit" disabled={busy || !value.trim() || !bookKey}>
              {busy ? 'finding it…' : 'Find my place'}
            </button>

            {error && <div className="error-text">{error}</div>}
          </form>
        )}

        {result && <Result row={result} book={book} onReset={reset} />}
      </main>
    </div>
  )
}
