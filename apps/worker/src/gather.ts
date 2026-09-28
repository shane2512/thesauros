// 6.1 step 1 — gather everything one iteration needs, deterministically.
//
// This module reads: the database (wallet, policy, recipients, vaults, obligations, ledger windows,
// the previous vault snapshot) and the chain (balances, positions, share prices, allowance
// remaining, code presence) and the oracle. It imports NO reasoning: the same snapshot feeds the
// approval path and `replay()`, both of which must work with SERV down (I7, NFR-4).
//
// Everything it returns is what `buildContext` (pure) and `evaluate` (pure) are given, so a decision
// is a pure function of this struct plus the policy version — which is exactly what makes it
// reproducible.
import { getAddress, type PublicClient } from 'viem';
import {
  countExecutionsSince,
  getActivePolicy,
  getWalletById,
  listObligationsUntil,
  listRecipients,
  listVaultRows,
  outflowsSince,
  recentDecisionProposalHashes,
  recentProposalHashes,
  type Db,
  type ObligationRow,
  type RecipientRow,
  type VaultRow,
  type Wallet,
} from '@thesauros/db';
import { detectRiskTriggers, type PriceAdapter } from '@thesauros/risk';
import {
  err,
  ok,
  zPolicy,
  type Address,
  type Hex,
  type Policy,
  type PriceQuote,
  type Result,
  type RiskTrigger,
} from '@thesauros/shared';
import {
  getBalances,
  getSharePrice,
  getVaultPosition,
  parseSpendPermission,
  readAllowanceRemaining,
  type SpendPermission,
  type VaultPosition,
} from '@thesauros/wallet';
import { getActiveSpendPermission, latestVaultSnapshot } from '@thesauros/db';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** SERV_REASONING §3: obligations inside the next 30 days are part of the liquidity picture. */
export const OBLIGATION_HORIZON_DAYS = 30;

export type GatheredVault = {
  id: string;
  name: string;
  address: Address;
  /** Asset-denominated value of the agent's position. */
  positionAssets: bigint;
  /** Shares + what a redeem pays right now — what `buildCalls` needs. */
  position: VaultPosition;
  /** `convertToAssets(1 share)`, for the drawdown comparison and the next snapshot row. */
  sharePrice: bigint;
  totalAssets: bigint;
  maxAllocationBps: number;
  flagged: boolean;
};

export type Gathered = {
  wallet: Wallet;
  policy: Policy;
  policyVersion: number;
  agent: Address;
  treasury: Address;
  usdc: Address;
  decimals: number;
  balances: { treasuryUsdc: bigint; agentUsdc: bigint };
  allowanceRemaining: bigint;
  allowancePeriodEnds?: Date;
  spendPermission?: SpendPermission;
  vaults: GatheredVault[];
  recipients: RecipientRow[];
  /** Scheduled obligations inside the 30-day horizon, soonest first. */
  obligations: ObligationRow[];
  /** Absent when no fresh quote could be read; the engine then falls back to the I11 parity. */
  quote?: PriceQuote;
  quoteDemo: boolean;
  riskTriggers: RiskTrigger[];
  contractHasCode: Record<string, boolean>;
  ledger: {
    outflowsLast24hMicroUsd: bigint;
    actionsLastHour: number;
    recentProposalHashes: Hex[];
  };
  /** Third-party strings that must be fenced and screened (RR-7). */
  untrusted: { id: string; source: string; text: string }[];
};

export type GatherDeps = {
  db: Db;
  publicClient: PublicClient;
  spendPermissionManagerAddress: Address;
  allowMainnet: boolean;
  now: () => Date;
  /** I11-fenced; absent outside DEMO_MODE. `Err` from it means "no quote", never "assume $1". */
  priceAdapter?: PriceAdapter | undefined;
  /**
   * Untrusted text the caller already has (incoming memos, external API text). The gatherer adds the
   * on-chain vault names, which are attacker-controlled for any vault that is not ours.
   */
  extraUntrusted?: { id: string; source: string; text: string }[] | undefined;
};

export type GatherError = { code: string; message: string };
const fail = (code: string, message: string): Result<never, GatherError> => err({ code, message });

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Read everything. Never throws; every failure is an `Err` the loop audits and aborts on (I5). */
export async function gather(
  deps: GatherDeps,
  walletId: string,
): Promise<Result<Gathered, GatherError>> {
  const { db, publicClient } = deps;
  const now = deps.now();

  const wallet = await getWalletById(db, walletId);
  if (!wallet) return fail('UNKNOWN_WALLET', `wallet ${walletId} not found`);
  if (!wallet.agentWalletAddress) return fail('NO_AGENT_WALLET', 'wallet has no agent wallet yet');
  const agent = getAddress(wallet.agentWalletAddress);

  const active = await getActivePolicy(db, walletId);
  if (!active) return fail('NO_ACTIVE_POLICY', 'wallet has no active policy');
  const parsed = zPolicy.safeParse(active.body);
  if (!parsed.success)
    return fail('POLICY_INVALID', `stored policy does not parse: ${parsed.error.message}`);
  const policy = parsed.data;
  if (wallet.chainId !== policy.chainId)
    return fail('CHAIN_MISMATCH', `wallet is on ${wallet.chainId}, policy on ${policy.chainId}`);

  const usdcToken = policy.tokens.find((t) => t.symbol === 'USDC');
  if (!usdcToken) return fail('NO_USDC', 'policy has no USDC token');
  const usdc = getAddress(usdcToken.address);
  const treasury = getAddress(policy.treasuryAddress);

  // ── chain reads ────────────────────────────────────────────────────────────────────────────────
  const balances = await getBalances(publicClient, {
    usdc,
    treasuryAddress: treasury,
    agentWalletAddress: agent,
  });
  if (!balances.ok) return fail('READ_FAILED', balances.error);

  const vaultRows = new Map<string, VaultRow>(
    (await listVaultRows(db, walletId)).map((v) => [v.id, v]),
  );
  const vaults: GatheredVault[] = [];
  const contractHasCode: Record<string, boolean> = { [usdc]: true };
  for (const v of policy.vaults) {
    const address = getAddress(v.address);
    const position = await getVaultPosition(publicClient, { vault: address, holder: agent });
    if (!position.ok) return fail('READ_FAILED', position.error);
    const price = await getSharePrice(publicClient, address);
    if (!price.ok) return fail('READ_FAILED', price.error);
    let code: string | undefined;
    try {
      code = await publicClient.getCode({ address });
    } catch (e) {
      return fail('READ_FAILED', `getCode(${address}) failed: ${String(e)}`);
    }
    contractHasCode[address] = (code ?? '0x') !== '0x';
    vaults.push({
      id: v.id,
      name: v.name,
      address,
      positionAssets: position.value.assets,
      position: {
        shares: position.value.shares,
        redeemableAssets: position.value.redeemableAssets,
      },
      sharePrice: price.value.sharePrice,
      totalAssets: price.value.totalAssets,
      maxAllocationBps: v.maxAllocationBps,
      flagged: vaultRows.get(v.id)?.flagged ?? false,
    });
  }

  // ── the spend permission and what is left of its period ────────────────────────────────────────
  let spendPermission: SpendPermission | undefined;
  let allowanceRemaining = 0n;
  let allowancePeriodEnds: Date | undefined;
  const permissionRow = await getActiveSpendPermission(db, walletId);
  if (permissionRow) {
    const permission = parseSpendPermission(permissionRow.permission);
    if (permission.ok) {
      spendPermission = permission.value;
      const remaining = await readAllowanceRemaining(
        publicClient,
        deps.spendPermissionManagerAddress,
        permission.value,
      );
      // A permission that cannot be read is worth ZERO allowance, never "unknown, assume fine" (I5).
      if (remaining.ok) allowanceRemaining = remaining.value;
      const period = Number(permission.value.period);
      const start = Number(permission.value.start);
      if (period > 0 && Number.isFinite(start)) {
        const elapsed = Math.max(0, Math.floor(now.getTime() / 1000) - start);
        allowancePeriodEnds = new Date(
          (start + (Math.floor(elapsed / period) + 1) * period) * 1000,
        );
      }
    }
  }

  // ── oracle + risk triggers ─────────────────────────────────────────────────────────────────────
  let quote: PriceQuote | undefined;
  let quoteDemo = false;
  if (deps.priceAdapter) {
    const read = await deps.priceAdapter.getPrice(usdc);
    if (read.ok) {
      quote = { microUsd: read.value.microUsd, publishedAt: read.value.publishedAt };
      quoteDemo = read.value.demo;
    }
  }

  const snapshotInputs = [];
  for (const v of vaults) {
    const previous = await latestVaultSnapshot(db, walletId, v.id);
    snapshotInputs.push({
      vaultId: v.id,
      current: v.sharePrice,
      previous: previous?.sharePrice,
    });
  }
  const riskTriggers = detectRiskTriggers({
    vaults: snapshotInputs,
    vaultDrawdownBps: policy.vaultDrawdownBps,
    depegThresholdBps: policy.depegThresholdBps,
    ...(quote === undefined ? {} : { assetMicroUsd: quote.microUsd }),
  });

  // ── db windows (R07 / R14 / R17) ───────────────────────────────────────────────────────────────
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  // R17 must see proposals that were DECIDED, not only ones that executed: an ESCALATE that is still
  // waiting on the owner would otherwise be re-proposed on every tick.
  const hashes = new Set<string>([
    ...(await recentProposalHashes(db, walletId, dayAgo)),
    ...(await recentDecisionProposalHashes(db, walletId, dayAgo)),
  ]);

  const horizon = new Date(now.getTime() + OBLIGATION_HORIZON_DAYS * DAY_MS);
  const obligations = await listObligationsUntil(db, walletId, isoDate(horizon));
  const recipients = await listRecipients(db, walletId);

  const untrusted = [
    // T1: a vault's on-chain name is written by whoever deployed it. It reaches a prompt, so it is
    // data, and it gets fenced, sanitized and screened like any memo.
    ...vaults.map((v) => ({
      id: `U_VAULT_${v.id}_NAME`,
      source: 'vault_name',
      text: v.name,
    })),
    ...(deps.extraUntrusted ?? []),
  ];

  return ok({
    wallet,
    policy,
    policyVersion: active.version,
    agent,
    treasury,
    usdc,
    decimals: usdcToken.decimals,
    balances: balances.value,
    allowanceRemaining,
    ...(allowancePeriodEnds === undefined ? {} : { allowancePeriodEnds }),
    ...(spendPermission === undefined ? {} : { spendPermission }),
    vaults,
    recipients,
    obligations,
    ...(quote === undefined ? {} : { quote }),
    quoteDemo,
    riskTriggers,
    contractHasCode,
    ledger: {
      outflowsLast24hMicroUsd: await outflowsSince(db, walletId, dayAgo),
      actionsLastHour: await countExecutionsSince(db, walletId, hourAgo),
      recentProposalHashes: [...hashes].filter((h): h is Hex => h.startsWith('0x')),
    },
    untrusted,
  });
}

/** `BuildContext` for `buildCalls` / the executor. */
export function buildContextOf(
  g: Gathered,
  spendPermissionManagerAddress: Address,
  allowMainnet: boolean,
) {
  return {
    agentWalletAddress: g.agent,
    spendPermissionManagerAddress,
    ...(g.spendPermission === undefined ? {} : { spendPermission: g.spendPermission }),
    agentUsdcBalance: g.balances.agentUsdc,
    vaultPositions: Object.fromEntries(g.vaults.map((v) => [v.id, v.position])),
    allowMainnet,
  };
}
