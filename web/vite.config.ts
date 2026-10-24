import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE is set by the workflow to "/<repo>/" for GitHub Pages project sites.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
