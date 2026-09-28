// R21 — chain guard (I8). The policy's chain must be the chain the executor is on, and mainnet
// needs an explicit flag from the caller. `packages/wallet` holds a second, independent lock
// (`assertChainAllowed` + `MAINNET_GATE_SIGNED_OFF`, D-17); the engine cannot import it, so it
// re-states the check here rather than trusting the caller.
import { deny, pass, type Rule } from './kit';

const MAINNET = 8453;

export const R21: Rule = (input) => {
  if (input.policy.chainId !== input.chainId)
    return deny(
      'R21',
      `policy is for chain ${input.policy.chainId}, execution is on ${input.chainId}`,
    );
  if (input.chainId === MAINNET && !input.allowMainnet)
    return deny('R21', 'mainnet requires an explicit allowMainnet flag');
  return pass('R21', `chain ${input.chainId} is allowed`);
};
