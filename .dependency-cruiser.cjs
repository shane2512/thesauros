// Import boundaries from docs/ARCHITECTURE.md §2 (I1/I2/I3). `pnpm check:arch` fails on any violation.
const pkg = (name) => `^packages/${name}/`;
const forbid = (name, from, to, comment) => ({
  name,
  comment,
  severity: 'error',
  from: { path: from },
  to: { path: to },
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // policy/src is pure (I2): only shared + @noble/hashes, no node core modules (net/fs/http/
    // crypto/env access). The rules are scoped to `src` so the test suite may use vitest/fast-check.
    forbid(
      'policy-only-shared',
      '^packages/policy/src/',
      '^(packages/(?!policy/|shared/)|apps/)',
      'policy may import only shared',
    ),
    {
      name: 'policy-no-core-or-network-deps',
      comment: 'policy must not use node core modules or npm deps other than @noble/hashes/shared',
      severity: 'error',
      from: { path: '^packages/policy/src/' },
      to: {
        dependencyTypes: [
          'core',
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: '^node_modules/@noble/hashes/',
      },
    },
    forbid(
      'reasoning-no-wallet-db',
      pkg('reasoning'),
      // D-33: the pure Policy Engine is readable from reasoning (validatePolicyDraft,
      // ruleSentences, explainVerdict). It has no I/O and cannot move funds; wallet/db/risk stay
      // forbidden, which is what I1/I3 actually protect.
      '^packages/(wallet|db|risk)/',
      'reasoning: shared + context + pure policy helpers only (I1/I3)',
    ),
    forbid(
      'context-no-wallet-db',
      pkg('context'),
      '^packages/(wallet|db|reasoning|policy|risk)/',
      'context is read-only glue',
    ),
    forbid(
      'wallet-no-reasoning',
      pkg('wallet'),
      '^packages/reasoning/',
      'wallet must not import reasoning (I1)',
    ),
    forbid(
      'risk-no-reasoning-wallet',
      pkg('risk'),
      '^packages/(reasoning|wallet)/',
      'risk: shared only',
    ),
    forbid('packages-no-apps', '^packages/', '^apps/', 'packages must not depend on apps'),
    // I7 — the owner path (freeze / revoke / sweep) must work with SERV, the LLM and the worker
    // all down, so it may never reach reasoning. Covers both the API routes and `sweepHome`.
    forbid(
      'owner-path-no-reasoning',
      // 7.8 widened this: unfreeze and the owner's revoke report are the same owner path, and the
      // freeze flow's own client module drives all three.
      // 8.1 widened it again: the shared revocation recorder and the worker's out-of-band revoke
      // scan are the same owner path and must survive a dead reasoning layer too.
      '^(apps/web/app/api/(freeze|unfreeze|sweep)/|apps/web/app/api/spend-permission/revoked/|apps/web/components/freeze/|apps/web/lib/ownerPath\\.ts$|packages/wallet/src/(sweepHome|revocation)\\.ts$|apps/worker/src/jobs/permissionScan\\.ts$)',
      '^packages/reasoning/',
      'owner-path modules never touch reasoning (I7)',
    ),
    // I1 — only the wallet bootstrap (and the manual, THESAUROS_LIVE-gated scripts) may hold a
    // send-capable wallet-provider client. Everything else, including `executor.ts`, receives the
    // send capability through the injected `TxSender` port, so nothing else in the repo can
    // broadcast even by accident. `provision.ts` is Phase 0's NotImplementedYet stand-in for
    // whatever Phase 2's Circle Wallets bootstrap becomes; the still-installed Coinbase SDK names
    // stay in the `to` pattern only so this rule keeps meaning something until that package is
    // dropped for good.
    {
      name: 'cdp-only-in-wallet-bootstrap',
      comment:
        'a send-capable wallet-provider client may only be constructed in the named bootstrap modules (I1)',
      severity: 'error',
      from: {
        path: '^(packages|apps|scripts)/',
        pathNot: '^(packages/wallet/src/provision\\.ts$|apps/web/lib/wallet\\.ts$|scripts/live/)',
      },
      to: { path: '@coinbase/(cdp-sdk|agentkit)' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // node_modules is excluded EXCEPT the two send-capable Coinbase packages: they have to stay
    // visible for `cdp-only-in-wallet-bootstrap` to have anything to match on (they are still not
    // followed, so nothing inside them is cruised).
    exclude: {
      // (`dist` is anchored to our own packages: @coinbase ships from a `dist/` folder too.)
      path: '(^|/)(\.next|\.turbo)/|^(apps|packages|scripts)/.*/dist/|(^|/)node_modules/(?!.*@coinbase/(cdp-sdk|agentkit))',
    },
    tsConfig: { fileName: require('node:path').join(__dirname, 'tsconfig.base.json') },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
