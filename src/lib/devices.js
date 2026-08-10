import { supabase } from './supabase'

/**
 * Which reading devices this login actually owns.
 *
 * Place was built around one reader with one of everything. Now two people
 * share the library and they do NOT own the same hardware: only Nate has the
 * Xteink X4, and showing someone a card telling them to sync a device they have
 * never seen is worse than showing nothing.
 *
 * Stored per user in the suite `user_settings` table (key `reader_devices`) as
 * a comma-separated list. That table is RLS'd to the owner, so each login reads
 * only its own row.
 *
 * This is presentation only. The box enforces the same thing independently
 * (X4_OWNER_ID / the ABS token map in the reading-sync poller), because a stale
 * client must never be able to jump somebody else's e-reader.
 */

const KEY = 'reader_devices'

// A new reader gets the devices everybody has. The X4 is opt-in precisely
// because it is the one device a wrong guess would push to.
export const DEFAULT_DEVICES = ['kindle', 'audiobook']

const CACHE_KEY = 'place_devices_v1'

function parse(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Read the device list. Falls back to the last known list, then to the default
 * -- a settings read that fails should not silently strip someone's X4 card.
 */
export async function loadDevices() {
  let cached = null
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
    const devices = data ? parse(data.value) : DEFAULT_DEVICES
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(devices))
    } catch {
      /* nothing to do */
    }
    return devices
  } catch {
    return cached?.length ? cached : DEFAULT_DEVICES
  }
}

/** Push targets for the box, derived from what this reader owns. */
export function targetsFor(devices) {
  const t = []
  if (devices.includes('x4')) t.push('x4')
  if (devices.includes('audiobook')) t.push('abs')
  return t
}
