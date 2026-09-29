'use client';
// The one signing state machine, shared by every owner-signature flow (policy activation, recipient
// add, approval, freeze/unfreeze/sweep). Two rules are structural, not left to each screen:
//
//  1. THE CLIENT NEVER BUILDS WHAT IT SIGNS. `prepare()` fetches the literal string from a server
//     route; `confirm()` signs exactly that string and nothing else.
//  2. A FAILED ATTEMPT THROWS THE PAYLOAD AWAY. `confirm()` clears `prepared` on any error, so a
//     retry goes back through `prepare()` and gets a fresh payload.
import { useCallback, useState } from 'react';
import { signErrorCopy, type SignError } from './signCopy';

export type SignPhase =
  'idle' | 'preparing' | 'review' | 'awaiting-signature' | 'submitting' | 'done' | 'error';

export const PHASE_STATUS: Record<SignPhase, string> = {
  idle: '',
  preparing: 'Preparing what you will sign.',
  review: 'Ready for you to review before signing.',
  'awaiting-signature': 'Waiting for your wallet. Check it for a signature request.',
  submitting: 'Sending your signature to Thesauros.',
  done: 'Done. Thesauros accepted your signature.',
  error: '',
};

export type SignFlow<P> = {
  phase: SignPhase;
  prepared: P | null;
  error: SignError | null;
  prepare: () => void;
  confirm: () => void;
  reset: () => void;
};

export function useSignFlow<P>(opts: {
  prepare: () => Promise<P>;
  sign: (prepared: P) => Promise<string>;
  submit: (prepared: P, signature: string) => Promise<void>;
  onDone?: () => void;
}): SignFlow<P> {
  const [phase, setPhase] = useState<SignPhase>('idle');
  const [prepared, setPrepared] = useState<P | null>(null);
  const [error, setError] = useState<SignError | null>(null);
  const { prepare: doPrepare, sign, submit, onDone } = opts;

  const prepare = useCallback(() => {
    setError(null);
    setPrepared(null);
    setPhase('preparing');
    void (async () => {
      try {
        const p = await doPrepare();
        setPrepared(p);
        setPhase('review');
      } catch (e) {
        setError(signErrorCopy(e));
        setPhase('error');
      }
    })();
  }, [doPrepare]);

  const confirm = useCallback(() => {
    if (prepared === null) return;
    setError(null);
    setPhase('awaiting-signature');
    void (async () => {
      try {
        const signature = await sign(prepared);
        setPhase('submitting');
        await submit(prepared, signature);
        setPhase('done');
        onDone?.();
      } catch (e) {
        setPrepared(null);
        setError(signErrorCopy(e));
        setPhase('error');
      }
    })();
  }, [onDone, prepared, sign, submit]);

  const reset = useCallback(() => {
    setPrepared(null);
    setError(null);
    setPhase('idle');
  }, []);

  return { phase, prepared, error, prepare, confirm, reset };
}
