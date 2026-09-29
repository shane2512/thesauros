'use client';
// What the connected wallet can and cannot do, checked BEFORE a signing flow asks for a signature.
//
// Steward's version also blocked a plain EOA from the spend-permission-grant screen (D-5, a Base
// Coinbase Smart Wallet concept). That whole blocker class is N/A here: Circle's developer-
// controlled wallets are never derived from — or gated on the type of — the connecting EOA at all
// (D-012/D-019 item 4), so the only two blockers that still apply are being disconnected and being
// on the wrong chain.
import { useEffect, useState } from 'react';
import { getInjectedProvider } from './injectedWallet';

export type SignerBlocker =
  { kind: 'disconnected' } | { kind: 'wrong-network'; chainId: number | undefined } | null;

export function useSigner(targetChainId: number | undefined): {
  blocker: SignerBlocker;
  switchNetwork: () => void;
  switching: boolean;
} {
  const [chainId, setChainId] = useState<number | undefined>(undefined);
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function read() {
      try {
        const provider = getInjectedProvider();
        const [accounts, hexChainId] = await Promise.all([
          provider.request({ method: 'eth_accounts' }) as Promise<string[]>,
          provider.request({ method: 'eth_chainId' }) as Promise<string>,
        ]);
        if (cancelled) return;
        setConnected(accounts.length > 0);
        setChainId(parseInt(hexChainId, 16));
      } catch {
        if (!cancelled) setConnected(false);
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  let blocker: SignerBlocker = null;
  if (connected === false) blocker = { kind: 'disconnected' };
  else if (targetChainId !== undefined && chainId !== undefined && chainId !== targetChainId) {
    blocker = { kind: 'wrong-network', chainId };
  }

  const switchNetwork = () => {
    if (targetChainId === undefined) return;
    setSwitching(true);
    void getInjectedProvider()
      .request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
      .catch(() => undefined)
      .finally(() => setSwitching(false));
  };

  return { blocker, switchNetwork, switching };
}

export const BLOCKER_COPY: Record<
  'disconnected' | 'wrong-network',
  { title: string; body: string }
> = {
  disconnected: {
    title: 'Your wallet is not connected',
    body: 'Thesauros needs your wallet to sign. Nothing moved. Connect it and come back to this step.',
  },
  'wrong-network': {
    title: 'Wrong network',
    body: 'Thesauros runs on Arc only. Nothing moved. Switch your wallet to Arc to carry on.',
  },
};
