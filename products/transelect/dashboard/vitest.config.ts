import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Playwright specs live under tests/e2e and are driven by
    // `npm run test:e2e`, never by vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
