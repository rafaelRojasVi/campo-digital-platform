import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORTAL_PORT ?? 5100)

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: false,
  },
  preview: {
    port,
    strictPort: false,
  },
})
