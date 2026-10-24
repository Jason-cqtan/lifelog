import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is set by the workflow to "/<repo>/" for GitHub Pages project sites.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // read VITE_* from the repo-root .env (Vite exposes only VITE_-prefixed keys to the page)
  envDir: '..',
  plugins: [react()],
})
