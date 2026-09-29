import { describe, expect, it } from 'vitest';
import { coverage } from '@/lib/dashboardModel';

describe('coverage', () => {
  it('floors to one decimal with bigint math', () => {
    expect(coverage(59_970_000n, 20_000_000n)).toBe('2.9x');
    expect(coverage(20_000_000n, 20_000_000n)).toBe('1.0x');
    expect(coverage(0n, 20_000_000n)).toBe('0.0x');
  });
  it('is null without a buffer', () => {
    expect(coverage(1n, null)).toBeNull();
    expect(coverage(1n, 0n)).toBeNull();
  });
});
