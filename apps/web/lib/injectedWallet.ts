// A deliberately thin wrapper over window.ethereum (MetaMask or any EIP-1193 injected wallet) rather
// than wagmi: every signature this app needs is a single personal_sign of a server-built message
// (SIWE-style sign-in, or one of @thesauros/shared's policy/recipient/freeze messages) — there is no
// multi-chain connector switching or contract-write UI to justify the extra dependency.
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  /** Populated by MetaMask (and several other wallets) when more than one wallet extension is
   * installed — the single `window.ethereum` slot otherwise goes to whichever extension injected
   * last, which is often Coinbase Wallet even when MetaMask is the one actually intended. */
  providers?: Eip1193Provider[];
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No injected wallet found (install MetaMask or a compatible wallet)');
  }
  const eth = window.ethereum;
  // Prefer MetaMask specifically when multiple extensions are present, rather than whichever one
  // happened to claim window.ethereum. Falls back to window.ethereum itself for a single-wallet
  // browser, or one whose provider doesn't announce a `providers` array at all.
  const metaMask = eth.providers?.find((p) => p.isMetaMask);
  return metaMask ?? eth;
}

export async function connectAddress(): Promise<string> {
  const accounts = (await getInjectedProvider().request({
    method: 'eth_requestAccounts',
  })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('wallet returned no accounts');
  return address;
}

export async function signMessage(address: string, message: string): Promise<string> {
  return (await getInjectedProvider().request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
}

// docs/VERIFY.md rows 1/2/13 — Arc has no built-in wallet_addEthereumChain entry in MetaMask's own
// chain list yet, so a wallet that has never visited an Arc app (or was last used for a different
// project on the same machine) shows whatever chain it already had selected — that's a fact about
// the wallet, not a request this app makes. Ask for the switch explicitly instead of hoping.
const ARC_CHAINS: Record<number, { chainName: string; rpcUrl: string; explorer: string }> = {
  5042002: {
    chainName: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
  },
  5042: {
    chainName: 'Arc',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
  },
};

/**
 * Switches the connected wallet to Arc, adding it first if the wallet has never seen it (EIP-3085
 * error 4902). personal_sign itself is chain-agnostic (sign-in works on any chain), but a wallet
 * left on a different chain from an earlier project is confusing and would break a real fund-moving
 * signature later, so the connect flow checks this up front rather than leaving it to surprise the
 * owner mid-flow.
 */
export async function ensureArcNetwork(chainId: number): Promise<void> {
  const target = ARC_CHAINS[chainId];
  if (!target) throw new Error(`unknown Arc chain id ${chainId}`);
  const provider = getInjectedProvider();
  const currentHex = (await provider.request({ method: 'eth_chainId' })) as string;
  const targetHex = `0x${chainId.toString(16)}`;
  if (currentHex.toLowerCase() === targetHex.toLowerCase()) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetHex }],
    });
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e
        ? (e as { code: unknown }).code
        : undefined;
    if (code !== 4902) throw e;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: targetHex,
          chainName: target.chainName,
          // Arc's native gas asset IS USDC at 18 decimals (docs/VERIFY.md row 3) — distinct from
          // the 6-decimal ERC-20 interface the app reads balances through.
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [target.rpcUrl],
          blockExplorerUrls: [target.explorer],
        },
      ],
    });
  }
}
