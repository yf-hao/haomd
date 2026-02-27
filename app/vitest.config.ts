import { defineConfig, mergeConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './vitest.setup.ts',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html', 'lcov'],
        reportsDirectory: './coverage',
        thresholds: {
          lines: 40,
          functions: 35,
          branches: 40,
          statements: 40
        },
        exclude: [
          'node_modules/**',
          'src/main.tsx',
          'src/vite-env.d.ts',
          '**/*.d.ts',
          '**/*.test.{ts,tsx}',
          '**/*.spec.{ts,tsx}',
          '**/__tests__/**',
          '**/types.ts'
        ]
      },
    },
  })
)
