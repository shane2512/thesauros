// The Policy Engine is the security core, so its own vitest config enforces what TESTING.md
// requires: 100% BRANCH coverage of `packages/policy/src`. The thresholds fail the run — a rule
// path nobody exercised is a rule path nobody has ever seen behave.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    root: import.meta.dirname,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
