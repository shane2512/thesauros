import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      'spikes/**',
      'docs/**',
      'contracts/**',
      'steward-claude-code-specs/**',
      'scripts/fixtures/**',
      'packages/db/drizzle/**',
      'apps/web/components/ui/**',
      '**/*.cjs',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // I2 — the Policy Engine is pure: no clock, no randomness, no env, no network, no globals.
    // `pnpm check:arch` covers imports; these rules cover the ambient ones a import graph cannot see.
    // Proven to fire by `pnpm check:lint:fixture` (scripts/fixtures/lint).
    files: ['**/packages/policy/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'packages/policy is pure (I2): no env or process access.' },
        { name: 'fetch', message: 'packages/policy is pure (I2): no network I/O.' },
        { name: 'crypto', message: 'packages/policy is pure (I2): use @noble/hashes.' },
        { name: 'globalThis', message: 'packages/policy is pure (I2): no ambient state.' },
        { name: 'window', message: 'packages/policy is pure (I2): no ambient state.' },
        { name: 'setTimeout', message: 'packages/policy is synchronous (I2).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'packages/policy must not read the clock (I2): `now` is injected via the input.',
        },
        {
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message: 'packages/policy must not read the clock (I2): `now` is injected via the input.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'packages/policy must be deterministic (I2): nonces are supplied by the caller.',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'packages/policy is pure (I2): no env access.',
        },
        {
          selector: 'AwaitExpression',
          message: 'packages/policy is synchronous (I2): no I/O, so nothing to await.',
        },
      ],
    },
  },
  {
    // `noUncheckedIndexedAccess` makes `calls[0]` possibly-undefined; in an assertion-heavy test a
    // `!` is the readable form and a wrong index fails the test anyway. Product code keeps the rule.
    files: ['**/test/**/*.ts', 'scripts/live/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
