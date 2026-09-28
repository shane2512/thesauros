// Fixture (`pnpm check:arch`'s `check-lint-fixture.mjs`): proves the packages/policy purity lint
// rules actually fire (I2). Every line here is a deliberate violation; none of this is real code.
export function impure(): number {
  process.env['X'];
  return Date.now();
}
