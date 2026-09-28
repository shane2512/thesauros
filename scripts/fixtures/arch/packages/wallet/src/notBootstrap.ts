// Fixture: proves `cdp-only-in-wallet-bootstrap` is enforced. Only `provision.ts` (and the manual,
// gated `scripts/live/` tools) may construct a send-capable Coinbase client (I1) — anything else
// that imports the SDK directly, like this file, must be flagged.
import { CdpClient } from '@coinbase/cdp-sdk';

export const violation = CdpClient;
