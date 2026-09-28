import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // apps/web component tests are .tsx and use the web app's `@/` alias (tsconfig paths).
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'apps/web/test/**/*.test.tsx',
      'scripts/*/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'spikes/**'],
    // DB tests share one thesauros_test database; run files serially.
    fileParallelism: false,
  },
});
