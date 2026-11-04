import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'worker',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/web/**'],
        },
      },
      {
        plugins: [react()],
        test: { name: 'web', environment: 'jsdom', include: ['tests/web/**/*.test.{ts,tsx}'] },
      },
    ],
  },
})
