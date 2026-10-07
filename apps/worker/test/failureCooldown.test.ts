import { describe, expect, it } from 'vitest';
import { SYSTEM_CEILINGS } from '@thesauros/shared';
import { inFailureCooldown } from '../src/loop';

const now = new Date('2026-10-07T14:20:00Z');
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

describe('inFailureCooldown', () => {
  it('holds off right after a failed execution', () => {
    expect(inFailureCooldown({ status: 'failed', createdAt: ago(60) }, now)).toBe(true);
    expect(inFailureCooldown({ status: 'timeout', createdAt: ago(60) }, now)).toBe(true);
  });

  it('resumes once the cool-down has passed', () => {
    const late = SYSTEM_CEILINGS.EXECUTION_FAILURE_COOLDOWN_SEC + 1;
    expect(inFailureCooldown({ status: 'failed', createdAt: ago(late) }, now)).toBe(false);
  });

  it('never blocks on a successful or in-flight execution', () => {
    expect(inFailureCooldown({ status: 'confirmed', createdAt: ago(5) }, now)).toBe(false);
    expect(inFailureCooldown({ status: 'submitted', createdAt: ago(5) }, now)).toBe(false);
  });
});
