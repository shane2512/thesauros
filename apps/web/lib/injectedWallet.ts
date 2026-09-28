// A deliberately thin wrapper over window.ethereum (MetaMask or any EIP-1193 injected wallet) rather
// than wagmi: every signature this app needs is a single personal_sign of a server-built message
// (SIWE-style sign-in, or one of @thesauros/shared's policy/recipient/freeze messages) — there is no
// multi-chain connector switching or contract-write UI to justify the extra dependency.
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
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
  return window.ethereum;
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
