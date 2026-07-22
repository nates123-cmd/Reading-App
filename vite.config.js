import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Fail the build when the Supabase env is missing, instead of shipping a
 * hollow bundle.
 *
 * src/lib/supabase.js throws at module scope if the env is absent. During a
 * production build rollup treats that as an unconditional throw and
 * dead-code-eliminates everything imported after it -- so the build still
 * reports "63 modules transformed / built in 271ms" and exits 0, but the
 * output is vendor code plus a throw, and the deployed page is blank white.
 *
 * This has bitten this suite more than once, and it is invisible in CI logs.
 * The only tell is the bundle SIZE, which nobody checks. So check the env
 * here, before any of that can happen.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k])

  if (missing.length && mode === 'production') {
    throw new Error(
      `Missing ${missing.join(', ')}.\n` +
        'Refusing to build: without these the app code is dead-code-eliminated, ' +
        'so the build "succeeds" while producing a blank page.\n' +
        'Locally: cp .env.example .env and fill it in.\n' +
        'In CI: check the repo secrets exist AND that the run started after they were set.',
    )
  }

  return {
    plugins: [react()],
    base: process.env.BASE_URL || '/',
  }
})
