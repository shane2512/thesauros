// The LLM trust boundary (SERV_REASONING.md). Reasoning proposes; deterministic code disposes.
// Nothing in this package can move funds: it has no wallet, no db and no tools (I1/I3), and every
// failure path ends in NOOP / UNSURE / the deterministic text (I5).
export {
  LiveServClient,
  FixtureServClient,
  requestHash,
  SERV_TASKS,
  type ServClient,
  type ServError,
  type ServErrorCode,
  type ServFixture,
  type ServLogFields,
  type ServRequest,
  type ServResponse,
  type ServTask,
  type ServUsage,
  type LiveServOptions,
} from './serv/client';

export { callJson, extractJson, type CallMeta, type ReasoningError } from './call';

export {
  loadPrompt,
  promptVersions,
  contextPayload,
  fenceUntrusted,
  buildProposerPrompt,
  buildVerifierPrompt,
  buildScreenPrompt,
  buildCompilerPrompt,
  buildExplainPrompt,
  FACT_FIELDS,
  VAULT_FIELDS,
  RECIPIENT_FIELDS,
  CONTEXT_FIELDS,
  PROMPT_NAMES,
  type BuiltPrompt,
  type Prompt,
  type PromptName,
} from './prompts';

export {
  SERV_SCHEMAS,
  jsonSchemaOf,
  zServProposal,
  zServVerification,
  zServScreen,
  zServMandate,
  zServExplanation,
  type ServProposal,
  type ServVerification,
  type ServScreen,
  type ServMandate,
} from './schemas';

export { screenText, screenItems, type HeuristicResult } from './heuristics';
export { screenUntrusted, type ScreenInput, type ScreenResult } from './screen';
export {
  propose,
  mapProposal,
  noopProposal,
  ADDRESS_RE,
  type ProposeInput,
  type ProposeOutcome,
} from './propose';
export { verify, describeAction, type VerifyInput, type VerifyOutcome } from './verify';
export { explain, verdictSentences, type ExplainInput, type ExplainOutcome } from './explain';
export {
  compileMandate,
  toDraft,
  ceilingsForPrompt,
  type CompileInput,
  type CompileOutcome,
} from './compile';
