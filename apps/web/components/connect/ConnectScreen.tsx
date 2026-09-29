'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { apiGet, apiPost } from '@/lib/api';
import { zConfig } from '@/lib/contracts';
import { connectAddress, ensureArcNetwork, signMessage } from '@/lib/injectedWallet';
import { ConnectView, type ConnectStep } from './ConnectView';

const zVerified = z.object({}).passthrough();

export function ConnectScreen() {
  const router = useRouter();
  const [step, setStep] = useState<ConnectStep>('idle');

  const connect = async () => {
    setStep('connecting');
    try {
      const address = await connectAddress();
      const { chainId } = await apiGet('/api/config', zConfig);
      await ensureArcNetwork(chainId); // wallet may still be on whatever chain it last used
      const res = await fetch(`/api/auth/nonce?address=${address}`);
      const { message } = (await res.json()) as { message: string };
      setStep('signing');
      const signature = await signMessage(address, message);
      setStep('verifying');
      await apiPost('/api/auth/verify', zVerified, { address, message, signature });
      setStep('signed_in');
      router.push('/onboarding');
    } catch (e) {
      setStep(isUserRejection(e) ? 'rejected' : 'error');
    }
  };

  return <ConnectView step={step} onConnect={() => void connect()} />;
}

function isUserRejection(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 4001
  );
}
