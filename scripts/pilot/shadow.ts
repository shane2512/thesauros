// Operator tool for pilots: switch a treasury into (or out of) shadow mode. In shadow mode the loop
// still proposes and records every verdict, but never sends and never asks for approval.
//   pnpm pilot:shadow <ownerAddress | walletId> on|off
import { appendAudit, createDb } from '@thesauros/db';
import { getEnv } from '@thesauros/shared';

try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
} catch {
  /* env may come from the shell */
}
const [who, mode] = process.argv.slice(2);
if (!who || (mode !== 'on' && mode !== 'off')) {
  console.error('usage: pnpm pilot:shadow <ownerAddress | walletId> on|off');
  process.exit(1);
}
const { pool, db } = createDb(getEnv().DATABASE_URL);
const found = (
  await pool.query(
    `select w.id, w.shadow, u.owner_address from wallets w join users u on u.id = w.user_id
     where w.id::text = $1 or lower(u.owner_address) = lower($1)`,
    [who],
  )
).rows;
if (found.length !== 1) {
  console.error(`expected exactly one wallet for "${who}", found ${found.length}`);
  await pool.end();
  process.exit(1);
}
const wallet = found[0] as { id: string; shadow: boolean; owner_address: string };
await pool.query('update wallets set shadow = $2 where id = $1', [wallet.id, mode === 'on']);
await appendAudit(db, {
  walletId: wallet.id,
  actor: 'system',
  event: 'SHADOW_MODE_SET',
  entityType: 'wallet',
  entityId: wallet.id,
  payload: { shadow: mode === 'on', was: wallet.shadow, set: 'operator script' },
  createdAt: new Date(),
});
console.log(`wallet ${wallet.id} (${wallet.owner_address}): shadow mode ${mode}`);
await pool.end();
