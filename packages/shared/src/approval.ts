// SECURITY §5 — the owner-approval message. One definition, used by the web route that verifies the
// signature and by the worker that re-verifies it before building `EvaluationInput.ownerApproval`
// (RR-1: the pure engine cannot check a signature, so its callers must).
//
// The format is fixed and human-readable on purpose: the owner's wallet shows exactly these five
// lines, so a phishing site cannot get a signature that Thesauros would accept for something else.
// It binds the wallet, the proposal hash, the policy version and an expiry — a signature for one
// proposal can never authorise another, an older policy, or a later moment.

/** Approvals expire 24 h after they are created (PHASES 6.4). */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ApprovalMessageInput = {
  walletId: string;
  proposalHash: string;
  policyVersion: number;
  expiresAt: Date;
};

/** `Thesauros approval\nWallet: …\nProposal: …\nPolicy: v…\nExpires: …` — SECURITY §5, verbatim. */
export function approvalMessage(input: ApprovalMessageInput): string {
  return [
    'Thesauros approval',
    `Wallet: ${input.walletId}`,
    `Proposal: ${input.proposalHash}`,
    `Policy: v${input.policyVersion}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}
