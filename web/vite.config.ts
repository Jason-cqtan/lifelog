import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is set by the workflow to "/<repo>/" for GitHub Pages project sites.
export default defineConfig(({ mode }) => {
  // VITE_* values are embedded in the public page: refuse a secret Mapbox token.
  const env = { ...loadEnv(mode, '..', 'VITE_'), ...process.env }
  if (env.VITE_MAPBOX_TOKEN?.startsWith('sk.')) {
    throw new Error('VITE_MAPBOX_TOKEN is a secret (sk.*) token; use a public pk.* token, it is visible in the page')
  }
  return {
    base: process.env.VITE_BASE || '/',
    // read VITE_* from the repo-root .env (Vite exposes only VITE_-prefixed keys to the page)
    envDir: '..',
    plugins: [react()],
  }
})
