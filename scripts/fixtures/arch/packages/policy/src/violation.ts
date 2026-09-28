// Fixture (`pnpm check:arch`'s `check-arch-fixture.mjs`): proves `policy-only-shared` is enforced.
// The Policy Engine must be pure (I2) — importing the wallet package here should be flagged.
import { getBalances } from '../../wallet/src/index';

export const violation = getBalances;
