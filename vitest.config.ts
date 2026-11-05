import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { cloudflareTest } from '@cloudflare/vitest-plugin'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({
          wrangler: { configPath: './wrangler.jsonc' },
          // Never let tests pick up real keys from .dev.vars: they must run with no LLM configured.
          miniflare: { bindings: {
            GEMINI_API_KEY: '',
            OPENROUTER_API_KEY: '',
            GEMINI_MODELS: '',
            LLM_PRIMARY: '',
            ADMIN_TOKEN: 'test-admin-token-0123456789abcdef',
            VISITOR_SECRET: 'test-visitor-secret-0123456789abcdef',
          } },
        })],
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
