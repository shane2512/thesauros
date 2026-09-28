// docs/DEMO.md beat 4: fire the over-cap and non-allowlisted-destination proposals against the
// seeded demo wallet (`pnpm db:seed:demo` first) and show the Policy Engine deny both, so the
// denial is reproducible on demand rather than hoped for live. Runs the real
// gather -> build -> simulate -> evaluate pipeline (apps/worker/src/{gather,pipeline}.ts) — not a
// second hand-rolled copy of it — with a hand-built Proposal standing in for what SERV would
// otherwise produce.
import { createDb } from '@thesauros/db';
import { getEnv, hashCanonical, type Proposal } from '@thesauros/shared';
import { publicClientFor } from '@thesauros/wallet';
import { insertAgentDecision } from '@thesauros/db';
import { gather } from '../../apps/worker/src/gather';
import { runPipeline } from '../../apps/worker/src/pipeline';
import { privateKeyToAccount } from 'viem/accounts';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  /* env may come from the shell */
}
const env = getEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const publicClient = publicClientFor(env);

const bigintToString = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

async function fire(label: string, walletId: string, proposal: Proposal) {
  const g = await gather(
    {
      db,
      publicClient,
      spendPermissionManagerAddress: env.SPEND_PERMISSION_MANAGER_ADDRESS as `0x${string}`,
      allowMainnet: env.THESAUROS_ALLOW_MAINNET,
      now: () => new Date(),
    },
    walletId,
  );
  if (!g.ok) {
    console.error(`${label}: could not gather context — ${g.error.code}: ${g.error.message}`);
    return;
  }
  const decision = await insertAgentDecision(db, {
    walletId,
    trigger: 'demo_attack',
    contextSnapshot: JSON.parse(JSON.stringify({ label }, bigintToString)) as unknown,
    contextHash: hashCanonical({
      label,
      proposal: JSON.parse(JSON.stringify(proposal, bigintToString)),
    }),
    proposal: JSON.parse(JSON.stringify(proposal, bigintToString)) as unknown,
    proposalSource: 'deterministic',
    status: 'pending',
  });

  const outcome = await runPipeline(
    {
      db,
      publicClient,
      sender: {
        getAddress: () => g.value.agent,
        send: async () => ({ ok: false, error: 'demo attack script never sends' }) as const,
      },
      receiptKey: new TextEncoder().encode('0'.repeat(32)), // never reached: this proposal is denied
      now: () => new Date(),
      spendPermissionManagerAddress: env.SPEND_PERMISSION_MANAGER_ADDRESS as `0x${string}`,
      allowMainnet: env.THESAUROS_ALLOW_MAINNET,
    },
    {
      g: g.value,
      decisionId: decision.id,
      proposal,
      screen: { injectionSuspected: false, signals: [] },
      verifier: null,
      contextFactIds: [],
      ownerApproval: null,
    },
  );

  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(outcome, null, 2));
}

async function main() {
  const walletId = process.argv[2];
  if (!walletId) throw new Error('usage: pnpm demo:attack <walletId>');

  const recipientId = process.argv[3] ?? 'not-a-real-recipient';
  const overCap: Proposal = {
    kind: 'pay_recipient',
    params: { recipientId, amount: 999_999_000_000n }, // way past any recipient/policy cap
    expectedDeltas: [],
    rationale: 'demo attack: over-cap payment',
    citedFactIds: [],
    confidence: 1,
    source: 'deterministic',
  };
  await fire('R06 over-cap payment', walletId, overCap);

  const unknownRecipient: Proposal = {
    kind: 'pay_recipient',
    params: {
      recipientId: `attacker-${privateKeyToAccount(`0x${'ee'.repeat(32)}`).address}`,
      amount: 1_000_000n,
    },
    expectedDeltas: [],
    rationale: 'demo attack: non-allowlisted destination',
    citedFactIds: [],
    confidence: 1,
    source: 'deterministic',
  };
  await fire('R05 non-allowlisted recipient', walletId, unknownRecipient);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
