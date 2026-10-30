import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

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
    build: {
      rollupOptions: {
        // the admin page (admin/index.html) talks to `lifelog serve` through /api/
        input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },
        output: {
          // own files: visitors re-download mapbox-gl only when it is upgraded, not with every
          // change to the site (the preload helper moves too, or these would import from main)
          manualChunks(id) {
            if (id.includes('vite/preload-helper')) return 'preload-helper'
            const part = id.match(/mapbox-gl\/dist\/esm\/(core|shared)\.js/)?.[1]
            if (part) return `mapbox-${part}`
          },
        },
      },
    },
    // mapbox-gl's worker is an ES module
    worker: { format: 'es' },
    server: {
      proxy: { '/api': process.env.LIFELOG_API || 'http://127.0.0.1:8080' },
    },
  }
})
