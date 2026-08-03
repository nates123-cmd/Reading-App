/**
 * Read a photo of a Kindle page and turn it into lines of book text.
 *
 * The Kindle is the one device in the stack that can be neither read from nor
 * written to, so the whole system's single manual input is "here is where I
 * stopped." Typing that phrase is the friction. A photo removes it: point the
 * camera at the page, and the words come off the screen instead of the keyboard.
 *
 * Nothing downstream changes. This produces a phrase, and the phrase goes into
 * the same `reading_sync_requests` row as a typed one (`anchor_type: 'phrase'`),
 * so the resolver, the kosync push and the audiobook seek are all untouched.
 *
 * The model call goes through the suite's shared `claude` edge function, which
 * relays image content blocks to the model with no server-side change. It is
 * JWT-gated, and every screen here is behind AuthGate, so the session token
 * authorises it.
 */

import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// 1568px on the long edge is where the vision models stop getting more out of
// an image, and a phone photo is several times that. Downscaling before upload
// is the difference between a ~200KB request and a ~4MB one on a phone
// connection, and it keeps us well under the API's base64 ceiling.
const MAX_EDGE = 1568
const JPEG_QUALITY = 0.8

// Transcribing a photographed page is a cheap job -- it is reading, not
// reasoning -- so it runs on the cheapest capable model the proxy relays.
// Measured against a rendered page: same line-for-line output as Sonnet, ~300
// input tokens, under two seconds.
const MODEL = 'gemini-2.5-flash'

const SYSTEM = `You transcribe a photograph of a single e-reader page.

Return ONLY a JSON object, no prose and no code fence:
{"lines": ["...", "..."], "chapter": "..." | null, "empty": false}

Rules:
- "lines" is the body text of the page, one entry per printed line, in reading
  order, transcribed EXACTLY as printed. Preserve the line breaks you see on the
  page; do NOT reflow, merge or rewrap lines, and do not fix the author's
  spelling or punctuation.
- Omit the running header, the footer, the page number, the clock, the battery
  and the progress bar. Body text only.
- If a word is hyphenated across a line break, repair it: put the whole word on
  the first of the two lines and drop the hyphen. The lines are searched against
  the book's own text, where no such hyphen exists.
- "chapter" is the chapter title if one is visible on the page, else null.
- Set "empty" to true if there is no legible book text in the image at all, and
  return an empty "lines" array.`

const USER_PROMPT =
  'Transcribe the body text of this e-reader page, one line per printed line.'

/** Downscale to MAX_EDGE and re-encode as JPEG. Returns { media_type, data }. */
async function toImageBlock(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    // for the request
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      },
    },
    // for the on-screen thumbnail, so the user can see what was read
    dataUrl,
  }
}

/** Tolerant JSON extraction — same shape as the other suite Claude clients. */
function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try {
    return JSON.parse(s)
  } catch {
    /* fall through to the brace scan */
  }
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

/**
 * A line worth sending to the resolver. Very short lines (a lone "he said.", a
 * chapter numeral) match hundreds of places in a book, so they are dropped from
 * the pickable list rather than offered and then rejected by the box.
 */
export function isUsableLine(line) {
  const words = String(line || '').trim().split(/\s+/).filter(Boolean)
  return words.length >= 4
}

/**
 * Call the shared `claude` edge function.
 *
 * Deliberately NOT `supabase.functions.invoke`. That helper attaches an
 * `x-client-info` header to every request, and the function's CORS policy
 * allows only `authorization, content-type, apikey` — so the browser's
 * preflight fails and the request never leaves the device. supabase-js reports
 * that as a bare "Failed to send request to Edge Function", which reads like
 * the function is down when nothing has been called at all.
 *
 * Sending the request ourselves, with only the headers the function allows,
 * sidesteps it without redeploying a function the whole suite shares.
 */
async function callProxy(body) {
  const { data, error: sessionError } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (sessionError || !token) throw new Error('Signed out — sign in and try again.')

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/claude`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the reader. Check your connection.')
  }

  const payload = await res.json().catch(() => null)
  if (!res.ok || payload?.error) {
    throw new Error(payload?.error || `The reader returned ${res.status}.`)
  }
  return payload
}

/**
 * Photo -> lines of page text.
 *
 * Returns { lines, usable, chapter, thumbnail }. `lines` is everything read,
 * `usable` is the subset long enough to resolve to a unique spot.
 * Throws with a human-readable message on failure.
 */
export async function readPage(file) {
  const { block, dataUrl } = await toImageBlock(file)

  const data = await callProxy({
    system: SYSTEM,
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: 'user', content: [block, { type: 'text', text: USER_PROMPT }] },
    ],
  })

  const text =
    typeof data === 'string'
      ? data
      : data?.text ||
        (Array.isArray(data?.content)
          ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
          : '')

  const parsed = extractJSON(text)
  if (!parsed) throw new Error('Could not read that photo. Try again in better light.')

  const lines = (Array.isArray(parsed.lines) ? parsed.lines : [])
    .map((l) => String(l).trim())
    .filter(Boolean)

  if (parsed.empty || lines.length === 0) {
    throw new Error(
      'No book text in that photo. Fill the frame with the page and keep it flat.',
    )
  }

  return {
    lines,
    usable: lines.filter(isUsableLine),
    chapter: parsed.chapter || null,
    thumbnail: dataUrl,
  }
}

/**
 * The default guess at where reading stopped: the last usable line on the page.
 *
 * Stopping at the bottom of a page is the common case — you finish the page,
 * then put it down. When it is wrong the user picks a different line, which is
 * why every line stays on screen rather than only this one.
 */
export function defaultLine({ usable, lines }) {
  const pool = usable?.length ? usable : lines || []
  return pool.length ? pool[pool.length - 1] : ''
}
