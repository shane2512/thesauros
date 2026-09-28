// The Policy Engine (POLICY_ENGINE.md §1). Pure, deterministic, synchronous: no clock, no
// randomness, no env, no I/O. Imports only `@thesauros/shared` and `@noble/hashes` — `pnpm check:arch`
// and the eslint rules for this package enforce it.
export { evaluate, runRules, APPROVAL_LIFTABLE } from './evaluate';
export { hashProposal, hashProposalSafe, ZERO_HASH } from './hash';
export {
  signReceipt,
  verifyReceipt,
  constantTimeEqual,
  type ReceiptError,
  type ReceiptErrorCode,
  type ReceiptExpectation,
  type SignReceiptOptions,
} from './receipt';
export { validatePolicyDraft, type PolicyIssue, type PolicyIssueCode } from './validate';
export { renderPolicyAsSentences, ruleSentences } from './sentences';
export { explainVerdict } from './explain';
export {
  MANDATE_TEMPLATES,
  MANDATE_TEMPLATE_NAMES,
  policyDraftFromTemplate,
  type MandateTemplate,
  type MandateTemplateName,
  type TemplateBinding,
} from './templates';
export { RULES, type Rule } from './rules';
export {
  baseUnitsToMicroUsd,
  microUsdToBaseUnits,
  proposalAmountBaseUnits,
  valueInput,
  type Valuation,
  depegBps,
  quoteAgeSeconds,
  priceOf,
  usdcToken,
  byAddress,
  ONE_USD_MICRO,
} from './units';
