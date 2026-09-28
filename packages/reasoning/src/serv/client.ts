// The one place a real network call to the reasoning provider would be made. `LiveServClient`
// deliberately refuses every call right now: the provider is not wired up yet (see docs/VERIFY.md
// row 12 — Sonnet, per CLAUDE.md §4 — and docs/PHASES.md Phase 3, which rebuilds this against the
// real API). Every task function above this file (propose/verify/screen/compile/explain) already
// fails closed on a client error, so a worker built against `LiveServClient` today degrades to
// deterministic-only behaviour instead of crashing (I5).
//
// `FixtureServClient` is the offline double used by tests: it answers from a scripted map (unit
// tests) or from previously recorded fixtures keyed by `requestHash` (golden replay), and never
// touches the network either.
import { createHash } from 'node:crypto';
import { err, ok, type Result, type Secret } from '@thesauros/shared';

export const SERV_TASKS = ['propose', 'verify', 'screen', 'compile', 'explain'] as const;
export type ServTask = (typeof SERV_TASKS)[number];

export type ServUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type ServRequestBase = {
  task: ServTask;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
};
export type ServRequest = ServRequestBase & { requestHash: string };

export type ServResponse = {
  text: string;
  requestId: string;
  model: string;
  usage?: ServUsage;
};

export type ServErrorCode = 'UNAVAILABLE' | 'NOT_IMPLEMENTED' | 'TRANSPORT' | 'RATE_LIMIT';
export type ServError = { code: ServErrorCode; message: string };

export type ServLogFields = { task: ServTask; model: string; requestHash: string };

export interface ServClient {
  call(request: ServRequest): Promise<Result<ServResponse, ServError>>;
}

/** Stable across process restarts: the fixture recorder and the golden replay must agree on it. */
export function requestHash(request: ServRequestBase): string {
  const canonical = JSON.stringify({
    task: request.task,
    model: request.model,
    system: request.system,
    user: request.user,
    schemaName: request.schemaName,
  });
  return `0x${createHash('sha256').update(canonical).digest('hex')}`;
}

export type LiveServOptions = { apiKey: Secret<string>; baseURL?: string | undefined };

/**
 * Not implemented yet (Phase 3). Constructing it is safe — the worker only builds one when an API
 * key is configured — but every `call` fails closed, which every task function above already
 * treats as "the model is unavailable this iteration."
 */
export class LiveServClient implements ServClient {
  constructor(private readonly options: LiveServOptions) {}

  async call(request: ServRequest): Promise<Result<ServResponse, ServError>> {
    void this.options;
    void request;
    return err({
      code: 'NOT_IMPLEMENTED',
      message: 'LiveServClient is not implemented yet — see docs/PHASES.md Phase 3',
    });
  }
}

export type ServFixture = {
  requestHash: string;
  task: ServTask;
  model: string;
  response: ServResponse;
  recordedAt: string;
};

/**
 * Test double: `scripted[task]` (unit tests) wins over a recorded fixture match (golden replay);
 * neither present means "the model is down," the same failure mode `LiveServClient` produces today.
 */
export class FixtureServClient implements ServClient {
  readonly calls: ServRequest[] = [];

  constructor(
    private readonly fixtures: readonly ServFixture[] = [],
    private readonly scripted: Partial<Record<ServTask, string>> = {},
  ) {}

  async call(request: ServRequest): Promise<Result<ServResponse, ServError>> {
    this.calls.push(request);
    const script = this.scripted[request.task];
    if (script !== undefined) {
      return ok({
        text: script,
        requestId: `fixture-${request.task}-${this.calls.length}`,
        model: request.model,
      });
    }
    const found = this.fixtures.find(
      (f) => f.requestHash === request.requestHash && f.task === request.task,
    );
    if (found) return ok(found.response);
    return err({ code: 'UNAVAILABLE', message: `no fixture for task "${request.task}"` });
  }
}
