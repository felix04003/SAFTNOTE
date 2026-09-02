import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['tests/**', 'node_modules/**'],
    coverage: {
      reporter: ['text', 'html'],
      thresholds: { lines: 80 },
    },
  },
});
