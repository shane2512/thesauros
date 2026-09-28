// 5.3 — deterministic risk triggers. PURE: no clock, no I/O, bigint only (I12).
//
// Two triggers exist, both from POLICY_ENGINE R20:
//   vault_drawdown — the vault's share price fell by >= policy.vaultDrawdownBps since the previous
//                    `vault_snapshots` row for that vault;
//   asset_depeg    — the vault's asset is priced more than policy.depegThresholdBps away from $1.
//
// All bps maths is multiplication only: `drop * 10_000 >= bps * previous`. No division, so there is
// no rounding window an attacker could sit inside (the same shape R09 uses, D-30).
import type { RiskTrigger } from '@thesauros/shared';

/** One `vault_snapshots` row, reduced to what the comparison needs. */
export type VaultSharePrice = {
  vaultId: string;
  /** `convertToAssets(1 share)` in asset base units — however the snapshot writer scaled it. */
  current: bigint;
  /** The previous snapshot for the same vault. Absent on the first ever snapshot: no trigger. */
  previous?: bigint | undefined;
};

export type DetectRiskTriggersInput = {
  vaults: readonly VaultSharePrice[];
  /** policy.vaultDrawdownBps */
  vaultDrawdownBps: number;
  /** policy.depegThresholdBps */
  depegThresholdBps: number;
  /** Current quote for the asset backing the vaults, micro-USD. Omit to skip the depeg check. */
  assetMicroUsd?: bigint | undefined;
};

const ONE_USD_MICRO = 1_000_000n;
const BPS = 10_000n;

/**
 * Compare the latest snapshot against the previous one and return every trigger that fires.
 *
 * Deterministic and total: same input ⇒ same output, never throws. A vault with no previous
 * snapshot, a zero/negative previous price, or a share price that rose produces no drawdown
 * trigger — we only ever flag a real, measured fall.
 */
export function detectRiskTriggers(input: DetectRiskTriggersInput): RiskTrigger[] {
  const triggers: RiskTrigger[] = [];
  const drawdownBps = BigInt(Math.max(0, Math.trunc(input.vaultDrawdownBps)));
  const depegBps = BigInt(Math.max(0, Math.trunc(input.depegThresholdBps)));

  for (const vault of input.vaults) {
    const previous = vault.previous;
    if (previous === undefined || previous <= 0n) continue;
    const drop = previous - vault.current;
    if (drop <= 0n) continue;
    if (drop * BPS >= drawdownBps * previous) {
      triggers.push({
        vaultId: vault.vaultId,
        trigger: 'vault_drawdown',
        observed: `share price ${previous} → ${vault.current} (−${bps(drop, previous)} bps, limit ${drawdownBps} bps)`,
      });
    }
  }

  const price = input.assetMicroUsd;
  if (price !== undefined) {
    const deviation = price >= ONE_USD_MICRO ? price - ONE_USD_MICRO : ONE_USD_MICRO - price;
    if (deviation * BPS >= depegBps * ONE_USD_MICRO) {
      // The depeg is a property of the asset, but R20 keys triggers by vault, so every vault
      // holding the asset is flagged. Vaults with no position still matter: R04 must refuse new
      // deposits into them while the asset is off peg.
      for (const vault of input.vaults) {
        triggers.push({
          vaultId: vault.vaultId,
          trigger: 'asset_depeg',
          observed: `asset priced ${price} micro-USD (${bps(deviation, ONE_USD_MICRO)} bps off $1.00, limit ${depegBps} bps)`,
        });
      }
    }
  }

  return triggers;
}

/** Deviation in basis points, floor-rounded. Display only — never a decision input. */
function bps(delta: bigint, base: bigint): bigint {
  return (delta * BPS) / base;
}
