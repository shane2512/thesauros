'use client';
// Edit an existing recipient's label/cap/schedule. The address is fixed — shown, not editable —
// since changing it is a different recipient, not an edit (see PATCH /api/policy/recipients/[id]'s
// own comment: an "edit address" endpoint is exactly the attack surface address poisoning exists to
// prevent). Otherwise mirrors AddRecipientSign: same two-step nonce+signature confirmation screen.
import { useState } from 'react';
import { Button, TextButton } from '@/components/primitives';
import { apiPatch } from '@/lib/api';
import { zRecipientEdited, type Recipient } from '@/lib/contracts';
import { z } from 'zod';
import { formatMoney, formatToken, groupAddress, toBig } from '@/lib/format';
import { parseUsdc, sixAndSix } from '@/lib/recipientForm';
import { useSignFlow } from '@/lib/useSignFlow';
import { useSigner } from '@/lib/useSigner';
import { connectAddress, signMessage } from '@/lib/injectedWallet';
import { BlockerPanel, FactRow, LiteralPayload, SignErrorPanel, SignStatus } from './SignSurface';

const FIELD =
  'mt-2 h-12 w-full rounded-sm bg-surface-2 px-4 text-small text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-accent';

const zPrepare = z.object({ message: z.string(), expiresAt: z.string() });
type Prepare = z.infer<typeof zPrepare>;

export function EditRecipientSign({
  recipient,
  onSaved,
  onCancel,
}: {
  recipient: Recipient;
  onSaved: (r: Recipient) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(recipient.label);
  const [max, setMax] = useState(formatToken(toBig(recipient.maxPerTx)));
  const [day, setDay] = useState(
    recipient.scheduleDayOfMonth ? String(recipient.scheduleDayOfMonth) : '',
  );
  const { blocker, switchNetwork, switching } = useSigner(undefined);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);

  const maxParsed = parseUsdc(max);
  const dayNumber = day === '' ? undefined : Number(day);
  const scheduleOk =
    dayNumber === undefined || (Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 28);
  const complete = label.trim() !== '' && maxParsed.ok && scheduleOk;

  const fields = () => ({
    label: label.trim(),
    maxPerTxUsdc: max.trim(),
    ...(dayNumber === undefined ? {} : { scheduleDayOfMonth: dayNumber }),
  });

  const flow = useSignFlow<Prepare>({
    prepare: () => apiPatch(`/api/policy/recipients/${recipient.id}`, zPrepare, fields()),
    sign: async (p) => {
      const addr = signerAddress ?? (await connectAddress());
      setSignerAddress(addr);
      return signMessage(addr, p.message);
    },
    submit: (p, signature) =>
      apiPatch(`/api/policy/recipients/${recipient.id}`, zRecipientEdited, {
        ...fields(),
        signature,
        message: p.message,
      }).then((r) => onSaved(r.recipient)),
  });

  if (blocker !== null && blocker.kind !== 'disconnected')
    return <BlockerPanel blocker={blocker} onSwitch={switchNetwork} switching={switching} />;

  const p = flow.prepared;

  return (
    <div data-testid="edit-recipient-sign">
      <div className="rounded-md bg-surface-2 p-4">
        <p className="font-mono text-label font-semibold tracking-[0.12em] text-muted uppercase">
          Address (fixed)
        </p>
        <p className="pt-2 font-mono text-mono break-all text-ink" data-testid="address-grouped">
          {groupAddress(recipient.address)}
        </p>
        <p className="pt-2 text-small text-muted">
          To pay a different address, remove this recipient and add a new one.
        </p>
      </div>

      {p === null ? (
        <>
          <label htmlFor="er-label" className="block pt-5 text-small font-semibold text-ink">
            Name
          </label>
          <input
            id="er-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={FIELD}
          />

          <label htmlFor="er-max" className="block pt-5 text-small font-semibold text-ink">
            Most per payment
          </label>
          <input
            id="er-max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            inputMode="decimal"
            className={`${FIELD} tabular`}
          />
          {max.trim() !== '' && !maxParsed.ok ? (
            <p role="alert" className="pt-1 text-small text-deny">
              Enter an amount in USDC, like 1200 or 1200.50.
            </p>
          ) : null}

          <label htmlFor="er-day" className="block pt-5 text-small font-semibold text-ink">
            Pay monthly on day (optional)
          </label>
          <input
            id="er-day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            inputMode="numeric"
            placeholder="1 to 28"
            className={`${FIELD} tabular`}
          />
        </>
      ) : (
        <div data-testid="recipient-edit-confirm">
          <div className="mt-4 rounded-md bg-surface-2 px-4 py-2">
            <FactRow label="Name">{label.trim()}</FactRow>
            <FactRow label="Most per payment">
              {formatMoney(maxParsed.ok ? maxParsed.value : 0n)}
            </FactRow>
            {dayNumber === undefined ? null : (
              <FactRow label="Every month on">day {dayNumber}</FactRow>
            )}
          </div>
          <p className="pt-2 font-mono text-mono text-faint">{sixAndSix(recipient.address)}</p>
          <LiteralPayload value={p.message} />
        </div>
      )}

      <SignStatus phase={flow.phase} />
      {flow.error ? <SignErrorPanel error={flow.error} onRetry={flow.reset} /> : null}

      <div className="pt-6">
        {p === null ? (
          <>
            <Button
              disabled={!complete}
              loading={flow.phase === 'preparing'}
              onClick={flow.prepare}
            >
              Save changes
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={onCancel}>Cancel</TextButton>
            </div>
          </>
        ) : (
          <>
            <Button
              loading={flow.phase === 'awaiting-signature' || flow.phase === 'submitting'}
              onClick={flow.confirm}
            >
              Sign and save
            </Button>
            <div className="pt-2 text-center">
              <TextButton onClick={flow.reset}>Go back and edit</TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
