// Fixture: proves `circle-wallets-only-in-wallet-bootstrap` is enforced. Only `provision.ts` (and
// the manual, gated `scripts/live/` tools) may construct a send-capable Circle Wallets client (I1)
// — anything else that imports the SDK directly, like this file, must be flagged.
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

export const violation = initiateDeveloperControlledWalletsClient;
