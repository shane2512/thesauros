// R20 — the pre-authorised safety action. A `risk_exit` may run autonomously even when the kind is
// not in `autonomousKinds`, but only when state actually carries the matching trigger AND the
// money only moves vault -> agent wallet. Nothing may ride out of the wallet on the back of a
// panic exit.
//
// When it passes for a `risk_exit`, `evaluate` converts R02's ESCALATE into a PASS. When no
// trigger is observed the exit is an ordinary non-autonomous action, so this rule escalates rather
// than granting the override.
import { escalate, deny, pass, type Rule } from './kit';

export const R20: Rule = (input) => {
  if (input.proposal.kind !== 'risk_exit') return pass('R20', 'not a risk exit');
  const { vaultId, trigger } = input.proposal.params;

  const observed = input.state.riskTriggers.find(
    (t) => t.vaultId === vaultId && t.trigger === trigger,
  );
  if (!observed) return escalate('R20', `no ${trigger} trigger observed for vault ${vaultId}`);

  const leaves = input.proposal.expectedDeltas.filter(
    (d) => d.holder !== 'agent' && d.delta !== 0n,
  );
  if (leaves.length > 0)
    return deny(
      'R20',
      `risk_exit must only move funds to the agent wallet, not ${leaves[0]?.holder}`,
    );
  const outgoing = input.proposal.expectedDeltas.filter((d) => d.delta < 0n);
  if (outgoing.length > 0) return deny('R20', 'risk_exit must not reduce any balance');

  return pass(
    'R20',
    `${trigger} on vault ${vaultId} authorises an autonomous exit (${observed.observed})`,
  );
};
