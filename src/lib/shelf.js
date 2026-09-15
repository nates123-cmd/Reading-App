import { supabase } from './supabase'

/**
 * Which books this reader is finished with.
 *
 * The catalog is the whole ebook library on the box and it only ever grows, so
 * after a couple of months the picker is mostly books you have already read and
 * the one you are actually reading is buried in the middle of an alphabetical
 * list. Marking a book finished hides it from the picker. Nothing else changes:
 * the file stays in the library, on the X4, and in Audiobookshelf.
 *
 * Stored per user in the suite `user_settings` table (key `place_done_books`)
 * as a comma-separated list of book_keys, the same shape as `reader_devices`.
 * Each reader has their own list -- one person finishing a book must not hide
 * it from the other.
 */

const KEY = 'place_done_books'
const CACHE_KEY = 'place_done_v1'

function parse(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function cache(keys) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(keys))
  } catch {
    /* private mode: nothing to do */
  }
}

/** Read the finished list. Falls back to the last known list, then to empty. */
export async function loadDone() {
  let cached = []
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) cached = JSON.parse(raw)
  } catch {
    /* private mode: just skip the cache */
  }

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
    if (error) throw error
    const keys = data ? parse(data.value) : []
    cache(keys)
    return keys
  } catch {
    return Array.isArray(cached) ? cached : []
  }
}

/** Write the whole list. The cache is updated first so the UI never snaps back. */
export async function saveDone(keys) {
  const list = Array.from(new Set(keys))
  cache(list)
  const { data: { user } = {} } = await supabase.auth.getUser()
  if (!user) throw new Error('not signed in')
  const { error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: user.id, key: KEY, value: list.join(',') },
      { onConflict: 'user_id,key' },
    )
  if (error) throw error
  return list
}
