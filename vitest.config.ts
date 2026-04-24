import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      all: true,
      enabled: false,
      exclude: ['dist/**', 'scripts/**', 'test/**'],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
