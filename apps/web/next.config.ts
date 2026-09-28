import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url)); // repo-root env; shell env wins
} catch {
  /* env may come from the shell */
}
// I11: the client-side "DEMO DATA" banner mirrors the server's own DEMO_MODE, not a separate flag —
// Next only inlines NEXT_PUBLIC_* vars it can see at build time, so this re-exposes the server one.
process.env.NEXT_PUBLIC_DEMO_MODE ??= process.env.DEMO_MODE;

const config: NextConfig = {
  devIndicators: false,
  ...(process.env.VERCEL
    ? {
        // Without this, Next's output file tracer only walks apps/web's own tree and misses
        // packages that live in the pnpm workspace root's node_modules/.pnpm store.
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
  experimental: { cpus: 1 },
  transpilePackages: [
    '@thesauros/shared',
    '@thesauros/db',
    '@thesauros/wallet',
    '@thesauros/policy',
    '@thesauros/reasoning',
    '@thesauros/context',
  ],
  serverExternalPackages: ['pg', 'pino'],
};
export default config;
