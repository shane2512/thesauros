// The injection screen. Deterministic heuristics (`heuristics.ts`) run first and unconditionally;
// the model classifier can only ADD a flag, never clear one the heuristics already raised, and it is
// skipped entirely when there is nothing untrusted to look at (budget) or when it fails (I5).
import { screenItems } from './heuristics';
import { callJson } from './call';
import { buildScreenPrompt } from './prompts';
import { SERV_SCHEMAS, zServScreen } from './schemas';
import type { CallMeta } from './call';
import type { ServClient } from './serv/client';

export type ScreenInput = {
  client: ServClient;
  model: string;
  items: readonly { id: string; text: string; source?: string; signals?: readonly string[] }[];
};

export type ScreenResult = {
  injectionSuspected: boolean;
  signals: string[];
  meta?: CallMeta;
};

export async function screenUntrusted(input: ScreenInput): Promise<ScreenResult> {
  if (input.items.length === 0) return { injectionSuspected: false, signals: [] };

  const heuristic = screenItems(input.items);

  const res = await callJson({
    client: input.client,
    task: 'screen',
    model: input.model,
    prompt: buildScreenPrompt(input.items),
    schema: SERV_SCHEMAS.screen,
    parser: zServScreen,
  });

  if (!res.ok) {
    return {
      injectionSuspected: heuristic.hit,
      signals: [...heuristic.signals, 'classifier:unavailable'],
      meta: res.error.meta,
    };
  }

  const classifier = res.value.value;
  const signals = [...heuristic.signals];
  if (classifier.suspected) {
    signals.push(
      'classifier:suspected',
      ...classifier.reasons.map((r) => `classifier_reason:${r}`),
    );
  } else {
    signals.push('classifier:clear');
  }
  return {
    injectionSuspected: heuristic.hit || classifier.suspected,
    signals,
    meta: res.value.meta,
  };
}
