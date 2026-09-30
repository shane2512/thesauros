// 5.1 — RiskGate simulation (SECURITY §3 Layer 4).
//
// APPROACH (D-022, superseding PHASES 5.1's original `eth_simulateV1` choice): Arc testnet's real
// RPC does not implement `eth_simulateV1` — it isn't in Arc's documented supported-methods list, and
// live testing confirmed it: every proposal was denied with "method not found" (see docs/VERIFY.md
// row 14). The original choice (PROGRESS D-40) was checked only against Base Sepolia and anvil,
// never against Arc itself.
//
// Fallback: Arc's predeployed `Multicall3From` (docs/VERIFY.md row 14) batches calls atomically in
// one `eth_call` — which Arc's RPC does support — while its `CallFrom` precompile preserves the
// original wallet as `msg.sender` for every subcall. That gives the same property `eth_simulateV1`
// was chosen for: *state carry-over across several calls in one call frame* (`approve` then
// `deposit` sees the allowance). `allowFailure: true` per call means one subcall reverting doesn't
// unwind an earlier one's effects — matching how the real executor also sends each call as its own
// separate transaction (`@thesauros/wallet`'s `circleTxSender`: Circle wallets have no native
// batching on Arc today), not one atomic multi-call, so this simulates the same failure granularity
// the real execution has.
//
// If the RPC does not answer this `eth_call` either, we return `Err` — we never fall back to a
// weaker simulation and call it the same thing (I5). `simulation: null`/not-ok ⇒ R11 DENY.
//
// Balance deltas are measured, not inferred: the same `eth_call` runs `balanceOf(holder)` before and
// after the real calls, so the deltas come from the EVM rather than from the proposal's claims
// (which is exactly what R11 compares them against).
import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type PublicClient,
} from 'viem';
import {
  err,
  ok,
  type Address,
  type Delta,
  type Hex,
  type Result,
  type SimulatedApproval,
} from '@thesauros/shared';

/** Structurally identical to `@thesauros/wallet`'s `Call`; `risk` must not import `wallet` (I1). */
export type SimCall = { to: Address; data: Hex; value: bigint };

/** docs/VERIFY.md row 14. Same address on mainnet and testnet (a predeployed system contract). */
const MULTICALL3_FROM_ADDRESS = getAddress('0x522fAf9A91c41c443c66765030741e4AaCe147D0');

const AGGREGATE3_ABI = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const;

const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** `approve(address,uint256)` selector. */
const APPROVE_SELECTOR = '0x095ea7b3';

export type SimHolder = Delta['holder'];

const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';

/**
 * `Multicall3From.aggregate3`'s per-call `returnData` on failure IS the revert data — decode the two
 * standard Solidity shapes (`Error(string)`, `Panic(uint256)`) so a failed simulation says why,
 * rather than a bare "reverted" (eth_simulateV1's own results carried a decoded message; this keeps
 * that same diagnostic value with the Multicall3From transport, D-022).
 */
function decodeRevertReason(data: Hex): string {
  if (!data || data === '0x') return 'reverted';
  try {
    if (data.startsWith(ERROR_STRING_SELECTOR)) {
      const [reason] = decodeAbiParameters([{ type: 'string' }], `0x${data.slice(10)}`);
      return reason || 'reverted';
    }
    if (data.startsWith(PANIC_SELECTOR)) {
      const [code] = decodeAbiParameters([{ type: 'uint256' }], `0x${data.slice(10)}`);
      return `panic 0x${code.toString(16)}`;
    }
  } catch {
    // fall through to the raw-data message below
  }
  return `reverted (${data})`;
}

type SimResultRow = {
  status: 'success' | 'failure';
  data: Hex;
  gasUsed: bigint;
  error?: { message: string };
};

/**
 * One `Multicall3From.aggregate3` round trip via a plain `eth_call` (never a signed/sent tx — this
 * only reads state). Shaped to match what `simulateCalls` used to return so the rest of this file
 * (`readBalance`, the per-call failure scan) didn't need to change.
 */
async function runSimulation(
  publicClient: PublicClient,
  account: Address,
  calls: readonly SimCall[],
): Promise<Result<{ results: SimResultRow[]; block: { number: bigint } }, SimulateError>> {
  try {
    const data = encodeFunctionData({
      abi: AGGREGATE3_ABI,
      functionName: 'aggregate3',
      args: [calls.map((c) => ({ target: c.to, allowFailure: true, callData: c.data }))],
    });
    const [{ data: returnData }, blockNumber] = await Promise.all([
      publicClient.call({ account, to: MULTICALL3_FROM_ADDRESS, data }),
      publicClient.getBlockNumber(),
    ]);
    if (!returnData) throw new Error('Multicall3From.aggregate3 returned no data');
    const decoded = decodeFunctionResult({
      abi: AGGREGATE3_ABI,
      functionName: 'aggregate3',
      data: returnData,
    });
    // Multicall3From's Result has no per-call gas figure (unlike eth_simulateV1's results) — not
    // used by any Policy Engine rule, only recorded on the `simulations` row, so 0n is fine here.
    const results: SimResultRow[] = decoded.map((r) => ({
      status: r.success ? 'success' : 'failure',
      data: r.returnData,
      gasUsed: 0n,
      ...(r.success ? {} : { error: { message: decodeRevertReason(r.returnData) } }),
    }));
    return ok({ results, block: { number: blockNumber } });
  } catch (e) {
    const message = String(e);
    const unsupported =
      /method not (found|supported)|does not exist|unsupported method|-32601/i.test(message);
    return err<SimulateError>({ code: unsupported ? 'UNSUPPORTED' : 'TRANSPORT', message });
  }
}

export type SimulateInput = {
  publicClient: PublicClient;
  /** The exact calls the executor will send, in order. */
  calls: readonly SimCall[];
  /** msg.sender for every call: the agent wallet. */
  from: Address;
  /** The token whose balances are measured (USDC in the MVP). */
  token: Address;
  /** Addresses to measure. `recipient` is present only for `pay_recipient`. */
  holders: { agent: Address; treasury: Address; recipient?: Address | undefined };
};

export type SimulationResult = {
  /** False when any call reverted. The deltas are then whatever the EVM got to before failing. */
  ok: boolean;
  deltas: Delta[];
  /** Every ERC-20 approval the calls contain (R18 / T5). Decoded from calldata, not from logs. */
  approvals: SimulatedApproval[];
  blockNumber: bigint;
  gasUsed: bigint;
  error?: string;
};

export type SimulateErrorCode = 'UNSUPPORTED' | 'TRANSPORT' | 'MALFORMED';
export type SimulateError = { code: SimulateErrorCode; message: string };

/**
 * Decode every ERC-20 approval in a call list. Pure — used by the risk gate to populate
 * `EvaluationInput.simulation.approvals`, which R18 needs to see or it passes blindly.
 */
export function extractApprovals(calls: readonly SimCall[]): SimulatedApproval[] {
  const out: SimulatedApproval[] = [];
  for (const call of calls) {
    if (!call.data.toLowerCase().startsWith(APPROVE_SELECTOR)) continue;
    try {
      const { args } = decodeApprove(call.data);
      out.push({ token: getAddress(call.to), spender: getAddress(args[0]), amount: args[1] });
    } catch {
      // A call that merely begins with the selector but does not decode is not an approval we can
      // vouch for. Surface it as an unbounded approval so R18 denies rather than shrugs (I5).
      out.push({
        token: getAddress(call.to),
        spender: getAddress(call.to),
        amount: 2n ** 256n - 1n,
      });
    }
  }
  return out;
}

function decodeApprove(data: Hex): { args: readonly [Address, bigint] } {
  // viem has no standalone decodeFunctionData typed helper that keeps the tuple shape here, so we
  // slice manually: 4-byte selector + two 32-byte words.
  if (data.length !== 2 + 8 + 64 * 2) throw new Error('approve calldata has the wrong length');
  const spender = getAddress(`0x${data.slice(10 + 24, 10 + 64)}`);
  const amount = BigInt(`0x${data.slice(10 + 64, 10 + 128)}`);
  return { args: [spender, amount] as const };
}

/**
 * Simulate the exact calls from the agent wallet and measure the resulting token deltas.
 *
 * Never throws. A revert inside the simulation is `ok({ ok: false, error })` — a real answer the
 * Policy Engine denies on (R11). Only a transport/feature problem is `Err`.
 */
export async function simulateProposalCalls(
  input: SimulateInput,
): Promise<Result<SimulationResult, SimulateError>> {
  const { publicClient, calls, from, token, holders } = input;

  const measured: { holder: SimHolder; address: Address }[] = [
    { holder: 'agent', address: getAddress(holders.agent) },
    { holder: 'treasury', address: getAddress(holders.treasury) },
    ...(holders.recipient
      ? [{ holder: 'recipient' as const, address: getAddress(holders.recipient) }]
      : []),
  ];

  const balanceCall = (address: Address): SimCall => ({
    to: getAddress(token),
    data: encodeFunctionData({ abi: BALANCE_OF_ABI, functionName: 'balanceOf', args: [address] }),
    value: 0n,
  });

  const pre = measured.map((m) => balanceCall(m.address));
  const post = measured.map((m) => balanceCall(m.address));
  const body: SimCall[] = calls.map((c) => ({ to: c.to, data: c.data, value: c.value }));

  const run = await runSimulation(publicClient, getAddress(from), [...pre, ...body, ...post]);
  if (!run.ok) return run;
  const simulated = run.value;

  const results = simulated.results;
  if (results.length !== pre.length + body.length + post.length)
    return err({ code: 'MALFORMED', message: 'simulation returned the wrong number of results' });

  const readBalance = (index: number): Result<bigint, SimulateError> => {
    const r = results[index];
    if (!r || r.status !== 'success')
      return err({ code: 'MALFORMED', message: `balanceOf #${index} did not return` });
    try {
      return ok(
        decodeFunctionResult({
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          data: r.data,
        }),
      );
    } catch (e) {
      return err({ code: 'MALFORMED', message: `balanceOf #${index}: ${String(e)}` });
    }
  };

  const deltas: Delta[] = [];
  for (let i = 0; i < measured.length; i++) {
    const before = readBalance(i);
    if (!before.ok) return before;
    const after = readBalance(pre.length + body.length + i);
    if (!after.ok) return after;
    const entry = measured[i];
    if (!entry) return err({ code: 'MALFORMED', message: 'holder list changed under us' });
    deltas.push({
      token: getAddress(token),
      holder: entry.holder,
      delta: after.value - before.value,
    });
  }

  let failure: string | undefined;
  let gasUsed = 0n;
  for (let i = 0; i < body.length; i++) {
    const r = results[pre.length + i];
    if (!r) return err({ code: 'MALFORMED', message: `missing result for call #${i}` });
    gasUsed += r.gasUsed;
    if (r.status !== 'success' && failure === undefined)
      failure = `call #${i} to ${body[i]?.to ?? '?'} reverted: ${r.error?.message ?? 'unknown'}`;
  }

  return ok({
    ok: failure === undefined,
    deltas,
    approvals: extractApprovals(calls),
    blockNumber: simulated.block.number ?? 0n,
    gasUsed,
    ...(failure === undefined ? {} : { error: failure }),
  });
}

/** The `simulations` row body (DATA_MODEL). Written by the caller through `@thesauros/db`. */
export function simulationRow(args: {
  decisionId: string;
  calls: readonly SimCall[];
  callsHash: Hex;
  result: SimulationResult;
}) {
  const { decisionId, calls, callsHash, result } = args;
  return {
    decisionId,
    calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
    callsHash,
    ok: result.ok,
    deltas: result.deltas.map((d) => ({ ...d, delta: d.delta.toString() })),
    error: result.error ?? null,
    blockNumber: result.blockNumber,
  };
}

export { APPROVE_ABI };
