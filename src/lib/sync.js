import { supabase } from './supabase'

/**
 * The app cannot talk to the Beelink directly: it is served over HTTPS while
 * KoInsight and the ebook library are plain HTTP on the LAN, so the browser
 * blocks the call as mixed content. Instead we write a request row and a
 * poller on the box does the work, then writes the answer back into the row.
 *
 * So every call here is: insert, then watch that row until it leaves 'pending'.
 */

const TERMINAL = ['done', 'failed', 'not_found', 'ambiguous']

/** Remember where each book was last synced, so a repeated phrase can be
 *  disambiguated by proximity. Without this, "she said" always resolves to its
 *  first occurrence in the book rather than the one you meant. */
const NEAR_KEY = 'place_last_position_v1'

export function lastPositionFor(bookKey) {
  try {
    const all = JSON.parse(localStorage.getItem(NEAR_KEY) || '{}')
    const v = all[bookKey]
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

export function rememberPosition(bookKey, textPercent) {
  if (typeof textPercent !== 'number') return
  try {
    const all = JSON.parse(localStorage.getItem(NEAR_KEY) || '{}')
    all[bookKey] = textPercent
    localStorage.setItem(NEAR_KEY, JSON.stringify(all))
  } catch {
    /* localStorage unavailable (private mode) -- proximity just gets skipped */
  }
}

export async function listBooks() {
  const { data, error } = await supabase
    .from('reading_books')
    .select('book_key,title,document_id,char_count')
    .order('title')
  if (error) throw error
  return data || []
}

export async function submitAnchor({ bookKey, bookTitle, anchorType, anchorValue, targets }) {
  const near = lastPositionFor(bookKey)
  const { data, error } = await supabase
    .from('reading_sync_requests')
    .insert({
      book_key: bookKey,
      book_title: bookTitle,
      anchor_type: anchorType,
      anchor_value: String(anchorValue),
      near,
      targets: targets && targets.length ? targets : ['x4'],
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Poll the row until the box has processed it. Polling rather than Realtime:
 * Realtime is not enabled on these tables, and a handful of 1s polls is a
 * cheaper thing to get right than a subscription that silently never fires.
 */
export async function awaitResult(id, { timeoutMs = 45000, intervalMs = 1000 } = {}) {
  const started = Date.now()
  for (;;) {
    const { data, error } = await supabase
      .from('reading_sync_requests')
      .select('id,status,result,detail')
      .eq('id', id)
      .single()
    if (error) throw error
    if (TERMINAL.includes(data.status)) return data
    if (Date.now() - started > timeoutMs) {
      return {
        ...data,
        status: 'timeout',
        detail:
          'The Beelink did not answer. Check that the reading-sync service is running.',
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export function formatPercent(v) {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '--'
}
