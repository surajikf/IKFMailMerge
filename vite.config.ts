import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Monolith: build output goes to ../dist; FastAPI (main.py) serves it alongside /api.
// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
