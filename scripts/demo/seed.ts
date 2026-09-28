// docs/DEMO.md's seeding step: one demo treasury, one compiled+active policy, two recipients at
// different risk tiers, and (via provisioning + policy activation themselves writing audit rows)
// enough history that the dashboard and audit trail are non-empty on first load. Idempotent: rerun
// it safely — a demo owner that already exists is reused rather than duplicated.
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  activatePolicyVersion,
  createDb,
  ensureWalletForUser,
  insertRecipient,
  latestPolicyVersion,
  listRecipients,
  setAgentWallet,
  upsertUserByAddress,
} from '@thesauros/db';
import { canonicalJson, getEnv, hashCanonical } from '@thesauros/shared';
import { policyDraftFromTemplate, type TemplateBinding } from '@thesauros/policy';
import { createCircleClient, provisionTreasuryWallet } from '@thesauros/wallet';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  /* env may come from the shell */
}
const env = getEnv();
const { db, pool } = createDb(env.DATABASE_URL);

// Fixed demo keys so reruns land on the same rows instead of minting new ones each time.
const owner = privateKeyToAccount(`0x${'de'.repeat(32)}` as const);
const acmeAddress = getAddress(privateKeyToAccount(`0x${'ac'.repeat(32)}` as const).address);
const watchlistAddress = getAddress(privateKeyToAccount(`0x${'bd'.repeat(32)}` as const).address);

async function main() {
  const now = new Date();
  const user = await upsertUserByAddress(db, owner.address, now);
  const wallet = await ensureWalletForUser(db, user.id, env.CHAIN_ID, owner.address);
  console.log(`demo owner ${owner.address}, wallet ${wallet.id}`);

  let agentWalletAddress = wallet.agentWalletAddress;
  if (!agentWalletAddress) {
    if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) {
      throw new Error(
        'CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET are required to provision the demo agent wallet',
      );
    }
    const client = createCircleClient({
      apiKey: env.CIRCLE_API_KEY,
      entitySecret: env.CIRCLE_ENTITY_SECRET,
    });
    // Circle rejects a wallet-set name over 50 chars; the full wallet id doesn't fit alongside the
    // prefix, so keep only enough of it to disambiguate between demo reseeds.
    const provisioned = await provisionTreasuryWallet(client, {
      name: `thesauros-demo-${wallet.id.slice(0, 8)}`,
    });
    if (!provisioned.ok) throw new Error(`Circle provisioning failed: ${provisioned.error}`);
    await setAgentWallet(db, wallet.id, {
      address: provisioned.value.address,
      walletSetId: provisioned.value.walletSetId,
      circleWalletId: provisioned.value.walletId,
    });
    agentWalletAddress = provisioned.value.address;
    console.log(`provisioned agent wallet ${agentWalletAddress} — fund it before running the demo`);
  } else {
    console.log(`reusing agent wallet ${agentWalletAddress}`);
  }

  // Two recipients: one clean, one the compliance beat (DEMO.md beat 5) will degrade to medium/high
  // via a re-screen — seeded at `low` here since screening.scan is what's supposed to change it.
  // `insertRecipient` no-ops on a rerun (unique wallet+address index) and returns undefined, so a
  // second pass reads the existing row back instead of skipping the seed.
  const acme =
    (await insertRecipient(db, {
      walletId: wallet.id,
      label: 'Acme Studio (contractor)',
      address: acmeAddress,
      maxPerTx: 2_000_000_000n, // 2,000 USDC in micro-USD
      schedule: { dayOfMonth: 1 },
      addedSignature: 'seed-script',
    })) ?? (await listRecipients(db, wallet.id)).find((r) => r.address === acmeAddress);
  const watchme =
    (await insertRecipient(db, {
      walletId: wallet.id,
      label: 'Watchlist Co (demo re-screen target)',
      address: watchlistAddress,
      maxPerTx: 5_000_000_000n,
      schedule: null,
      addedSignature: 'seed-script',
    })) ?? (await listRecipients(db, wallet.id)).find((r) => r.address === watchlistAddress);
  if (!acme || !watchme) throw new Error('failed to seed/read demo recipients');
  console.log(
    'recipients:',
    [acme, watchme].map((r) => r.label),
  );

  const binding: TemplateBinding = {
    chainId: env.CHAIN_ID as 5042002 | 5042,
    treasuryAddress: getAddress(wallet.treasuryAddress),
    usdcAddress: getAddress(env.USDC_ADDRESS),
    vaults: [],
    recipients: [acme, watchme].map((r) => ({
      id: r.id,
      label: r.label,
      address: getAddress(r.address),
      maxPerTxMicroUsd: r.maxPerTx.toString(),
    })),
  };
  const draft = policyDraftFromTemplate('startup', binding);
  if (!draft.ok) throw new Error(`policy draft invalid: ${JSON.stringify(draft.error)}`);

  const version = (await latestPolicyVersion(db, wallet.id)) + 1;
  const bodyHash = hashCanonical(draft.value);
  // zPolicyDraft makes version/walletId/createdAt/signedBy/signature optional precisely because a
  // draft predates activation; the Policy Engine only ever evaluates a full, signed Policy, so
  // these five envelope fields have to be added before this becomes the active policy body.
  const fullPolicy = {
    ...draft.value,
    version,
    walletId: wallet.id,
    createdAt: now.toISOString(),
    signedBy: owner.address,
    signature: '0x' + '00'.repeat(65), // seed script; zHex requires 0x-hex, not a real signature
  };
  await activatePolicyVersion(db, {
    walletId: wallet.id,
    version,
    mandateId: null,
    // jsonb goes through the pg driver's own JSON.stringify, which throws on a raw bigint
    // (limits/maxPerTxMicroUsd etc.) — canonicalJson already turns those into decimal strings.
    body: JSON.parse(canonicalJson(fullPolicy)) as unknown,
    bodyHash,
    signature: 'seed-script',
    now,
  });
  console.log(`activated policy v${version}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
