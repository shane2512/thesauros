// Fixture: proves `reasoning-no-wallet-db` is enforced. Reasoning must have no wallet or db access
// (I1/I3) — it proposes, it never reads or writes state that could move funds.
import { getBalances } from '../../wallet/src/index';

export const violation = getBalances;
