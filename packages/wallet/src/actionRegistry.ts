// Turns an evaluated Proposal into the calls that would carry it out, and the deterministic hash
// `execute()` uses as its idempotency key (I10). Every address here comes from the POLICY, by
// exact id resolution — never from the proposal (I4) — mirroring R04/R05's own resolution so a
// build can never target something the Policy Engine wouldn't also recognize.
import { encodeFunctionData, keccak256, toHex } from 'viem';
import {
  err,
  ok,
  type Address,
  type Hex,
  type Policy,
  type PolicyRecipient,
  type PolicyVault,
  type Proposal,
  type Result,
} from '@thesauros/shared';
import { ERC20_ABI, ERC4626_ABI } from './abi';
import type { SpendPermission } from './spendPermission';

export type Call = { to: Address; data: Hex; value: bigint };

/** A vault position as read from the chain: shares held, and what a redeem would pay out now. */
export type VaultPosition = { shares: bigint; redeemableAssets: bigint };

export type BuildContext = {
  agentWalletAddress: Address;
  spendPermissionManagerAddress: Address;
  spendPermission?: SpendPermission;
  agentUsdcBalance: bigint;
  vaultPositions: Record<string, VaultPosition>;
  allowMainnet: boolean;
};

export type BuildCallsErrorCode =
  'NOT_IMPLEMENTED' | 'NO_USDC_TOKEN' | 'UNKNOWN_VAULT' | 'UNKNOWN_RECIPIENT' | 'NO_POSITION';
export type BuildCallsError = { code: BuildCallsErrorCode; message: string };

const fail = (code: BuildCallsErrorCode, message: string): Result<Call[], BuildCallsError> =>
  err({ code, message });

function usdcAddress(policy: Policy): Address | undefined {
  return policy.tokens.find((t) => t.symbol === 'USDC')?.address;
}

function resolveVault(policy: Policy, vaultId: string): PolicyVault | undefined {
  return policy.vaults.find((v) => v.id === vaultId);
}

function resolveRecipient(policy: Policy, recipientId: string): PolicyRecipient | undefined {
  return policy.recipients.find((r) => r.id === recipientId);
}

const transferCall = (token: Address, to: Address, amount: bigint): Call => ({
  to: token,
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to, amount] }),
  value: 0n,
});

const approveCall = (token: Address, spender: Address, amount: bigint): Call => ({
  to: token,
  data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] }),
  value: 0n,
});

/**
 * Builds the calls a proposal would execute. Nothing here sends anything — `execute()` (I1) is the
 * only caller, and only with a valid `AllowReceipt`. `pull_allowance` stays `NOT_IMPLEMENTED`: it
 * is Base Spend Permission's "pull from the owner's EOA into the agent wallet" step, and Circle's
 * developer-controlled wallet model has no equivalent — the treasury wallet already holds the
 * funds directly, so there is nothing to design here until that's reconsidered (docs/PROGRESS.md).
 */
export function buildCalls(
  proposal: Proposal,
  policy: Policy,
  ctx: BuildContext,
): Result<Call[], BuildCallsError> {
  if (proposal.kind === 'noop') return ok([]);

  const usdc = usdcAddress(policy);
  if (!usdc) return fail('NO_USDC_TOKEN', 'policy has no USDC token');

  switch (proposal.kind) {
    case 'pull_allowance':
      return fail(
        'NOT_IMPLEMENTED',
        'pull_allowance is Base Spend-Permission-specific; Circle developer-controlled wallets hold funds directly (see docs/PROGRESS.md)',
      );

    case 'sweep_home':
      return ok([transferCall(usdc, policy.treasuryAddress, ctx.agentUsdcBalance)]);

    case 'pay_recipient': {
      const recipient = resolveRecipient(policy, proposal.params.recipientId);
      if (!recipient)
        return fail(
          'UNKNOWN_RECIPIENT',
          `recipientId "${proposal.params.recipientId}" is not on the policy allowlist`,
        );
      return ok([transferCall(usdc, recipient.address, proposal.params.amount)]);
    }

    case 'vault_deposit': {
      const vault = resolveVault(policy, proposal.params.vaultId);
      if (!vault)
        return fail(
          'UNKNOWN_VAULT',
          `vaultId "${proposal.params.vaultId}" is not on the policy allowlist`,
        );
      const { amount } = proposal.params;
      return ok([
        approveCall(usdc, vault.address, amount),
        {
          to: vault.address,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: 'deposit',
            args: [amount, ctx.agentWalletAddress],
          }),
          value: 0n,
        },
      ]);
    }

    case 'vault_withdraw': {
      const vault = resolveVault(policy, proposal.params.vaultId);
      if (!vault)
        return fail(
          'UNKNOWN_VAULT',
          `vaultId "${proposal.params.vaultId}" is not on the policy allowlist`,
        );
      // D-024: Circle's real USYC Teller only documents deposit()/redeem() (a full share-based
      // exit) — no by-asset-amount withdraw(). A partial withdrawal from a Teller-kind vault isn't
      // buildable; risk_exit's full redeem() below still works for it.
      if (vault.kind === 'usyc_teller')
        return fail(
          'NOT_IMPLEMENTED',
          'partial vault_withdraw is not available for a Teller-backed vault (Circle exposes deposit/redeem only); use a full risk_exit instead',
        );
      return ok([
        {
          to: vault.address,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: 'withdraw',
            args: [proposal.params.amount, ctx.agentWalletAddress, ctx.agentWalletAddress],
          }),
          value: 0n,
        },
      ]);
    }

    case 'risk_exit': {
      const vault = resolveVault(policy, proposal.params.vaultId);
      if (!vault)
        return fail(
          'UNKNOWN_VAULT',
          `vaultId "${proposal.params.vaultId}" is not on the policy allowlist`,
        );
      const position = ctx.vaultPositions[vault.id];
      if (!position || position.shares <= 0n)
        return fail('NO_POSITION', `no shares held in vault "${vault.id}" to exit`);
      // A panic exit redeems the WHOLE position — never a partial amount the proposal made up — and
      // money only ever moves vault -> agent wallet (R20's own contract-level guarantee).
      return ok([
        {
          to: vault.address,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: 'redeem',
            args: [position.shares, ctx.agentWalletAddress, ctx.agentWalletAddress],
          }),
          value: 0n,
        },
      ]);
    }
  }
}

/** Pure and deterministic: same calls, same hash, every time (I10). */
export function callsHash(calls: readonly Call[]): Hex {
  const canonical = JSON.stringify(
    calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
  );
  return keccak256(toHex(canonical));
}
