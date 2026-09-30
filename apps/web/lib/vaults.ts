// Shared by /api/policy/vaults — Next.js route files may only export recognized handlers.
import type { listVaultRows } from '@thesauros/db';

export function serializeVault(v: Awaited<ReturnType<typeof listVaultRows>>[number]) {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    kind: v.kind,
    maxAllocationBps: v.maxAllocationBps,
    flagged: v.flagged,
  };
}
