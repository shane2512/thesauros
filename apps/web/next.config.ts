import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url)); // repo-root env; shell env wins
} catch {
  /* env may come from the shell */
}

const config: NextConfig = {
  // the dev overlay sits on top of the design preview's screenshots
  devIndicators: false,
  // Output file tracing (below) only matters for Vercel's per-route serverless packaging — a
  // persistent-process host like Render needs none of it (node_modules is just there at runtime),
  // and force-tracing two full SDK trees across ~30 API routes is expensive enough at build time to
  // OOM a constrained build container. Gate it behind Vercel's own build-time env var.
  ...(process.env.VERCEL
    ? {
        // Without this, Next's output file tracer only walks apps/web's own tree and misses
        // packages that live in the pnpm workspace root's node_modules/.pnpm store — exactly the
        // externalized packages below. Symptom without this: builds fine, then 500s at runtime
        // with "Cannot find module '@coinbase/agentkit'" because the function shipped without it.
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
        // outputFileTracingRoot alone still didn't pick these up: @coinbase/agentkit and
        // @base-org/account are dependencies of packages/wallet (a transpiled workspace package),
        // not of apps/web itself, so the tracer never resolves the require() calls packages/wallet's
        // inlined code makes to them. Force them in explicitly, transitive deps included.
        outputFileTracingIncludes: {
          '/api/**': [
            '../../node_modules/.pnpm/@coinbase+agentkit@*/**',
            '../../node_modules/.pnpm/@base-org+account@*/**',
          ],
        },
      }
    : {}),
  // Reduces peak build memory: each parallel worker independently loads the same heavy SDKs
  // (CDP, AgentKit, viem, wagmi) while collecting page data, and constrained build containers
  // (e.g. Render's free/starter tier) can OOM under the default worker count.
  experimental: { cpus: 1 },
  transpilePackages: [
    '@thesauros/shared',
    '@thesauros/db',
    '@thesauros/wallet',
    '@thesauros/policy',
    '@thesauros/reasoning',
    '@thesauros/context',
  ],
  // 'jose' (ESM-only) is @coinbase/cdp-sdk's JWT auth dep. Next's build-time page-data collection
  // does a raw require() of externalized packages, and cdp-sdk's own require()/dynamic-import() of
  // jose race each other (ERR_REQUIRE_ESM_RACE_CONDITION) unless jose is externalized the same way.
  // @coinbase/agentkit's baseAccountActionProvider pulls in @base-org/account, which ships its own
  // pre-bundled, pinned-old copy of viem (and a matching-but-incompatible @noble/hashes). Webpack
  // merges that into the same chunk as our app's own (newer) viem, and the two @noble/hashes copies
  // collide at runtime (TypeError inside sha3.js, hit via keccak256/getAddress while Next collects
  // page data for any route touching the wallet). Externalizing keeps them in separate, independently
  // resolved node_modules trees instead of one merged bundle.
  serverExternalPackages: [
    'pg',
    'pino',
    '@coinbase/cdp-sdk',
    'jose',
    '@coinbase/agentkit',
    '@base-org/account',
  ],
  // The CDP SDK drags in Solana/x402 packages whose versions do not line up when webpack bundles
  // them. It only ever runs on the server, so keep it (and them) out of the bundle.
  webpack: (cfg, { isServer }) => {
    if (isServer)
      cfg.externals = [
        ...(cfg.externals ?? []),
        '@coinbase/cdp-sdk',
        '@coinbase/agentkit',
        '@base-org/account',
        /^@x402\//,
        /^@solana/,
      ];
    // wagmi/connectors pulls in @metamask/sdk (for its metaMask() connector, which we don't use —
    // wagmi.ts only wires coinbaseWallet/injected). @metamask/sdk's web bundle still references this
    // React-Native-only optional dep without a bundler guard, breaking the client build.
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      '@react-native-async-storage/async-storage': false,
    };
    return cfg;
  },
};
export default config;
