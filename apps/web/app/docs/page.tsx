import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Docs — Thesauros',
  description:
    'How Thesauros works: writing a mandate, the guardrails that bound the agent, payments, yield, owner controls and the security model.',
};

type Section = { id: string; title: string };

const SECTIONS: Section[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'how-it-works', title: 'How it works' },
  { id: 'quick-start', title: 'Quick start' },
  { id: 'mandate', title: 'Writing a mandate' },
  { id: 'guardrails', title: 'Guardrails' },
  { id: 'payments', title: 'Payments and recipients' },
  { id: 'yield', title: 'Idle cash and yield' },
  { id: 'activity', title: 'Activity and audit' },
  { id: 'owner-controls', title: 'Owner controls' },
  { id: 'security', title: 'Security model' },
  { id: 'testnet', title: 'Testnet and limits' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
];

const RULES: [string, string, string][] = [
  ['R00', 'Valid proposal', 'The proposal parses against its schema and its kind is known.'],
  [
    'R01',
    'Not frozen',
    'Nothing runs while the treasury is frozen or the circuit breaker is open. Only an owner-requested sweep home is exempt.',
  ],
  [
    'R02',
    'Allowed kind',
    'The kind of action is one your mandate lets the agent do without asking.',
  ],
  [
    'R03',
    'Sweep is owner-only',
    'Only you can empty the agent wallet. No model and no scheduler can.',
  ],
  [
    'R04',
    'Vault allowlist',
    'A vault must be on your signed allowlist, have code at its address, use an approved token and not be flagged by a risk trigger.',
  ],
  [
    'R05',
    'Recipient allowlist',
    'A recipient must be on your signed list. Addresses come from the policy and nowhere else; there is no name resolution and no "looks similar" matching.',
  ],
  [
    'R06',
    'Per-transaction size',
    'The amount is above zero and within your per-transaction limit, the system hard cap and that recipient’s own cap.',
  ],
  ['R07', 'Daily limit', 'Outflows in the rolling 24 hours stay within your daily limit.'],
  [
    'R08',
    'Cash buffer',
    'Liquid USDC after the action must still cover the buffer you set. A deposit that breaks it is refused; a payment that breaks it asks you first.',
  ],
  [
    'R09',
    'Concentration',
    'No vault may hold more than its share of managed funds. A breach asks you first.',
  ],
  ['R10', 'Approval threshold', 'At or above the threshold you set, you decide, not the agent.'],
  [
    'R11',
    'Simulation parity',
    'A dry run of the transaction must change balances exactly as the proposal said it would.',
  ],
  [
    'R12',
    'Price freshness and depeg',
    'A stale price, or a stablecoin off its peg, refuses the action. Stale data never becomes an approval.',
  ],
  [
    'R13',
    'Operating allowance',
    'A pull from your treasury may not exceed the agent’s remaining allowance.',
  ],
  [
    'R14',
    'Rate limit',
    'A bug or a loop that keeps proposing hits a cap on actions per hour before it can drain anything.',
  ],
  [
    'R15',
    'Second opinion',
    'A separate verifier re-checks model proposals. Disagreement refuses; uncertainty asks you.',
  ],
  [
    'R16',
    'Injection screen',
    'If untrusted text looks like an attempt to steer the model, any move of value away from your treasury is refused.',
  ],
  ['R17', 'Repeat guard', 'The same action cannot be proposed twice inside 24 hours.'],
  [
    'R18',
    'Exact approvals',
    'A token approval must be for exactly the amount being deposited, to the vault of that deposit.',
  ],
  [
    'R19',
    'Grounding',
    'Every fact a proposal cites must exist in the data snapshot it was built from. Low confidence asks you.',
  ],
  [
    'R20',
    'Safety exit',
    'A risk exit from a vault back to the agent wallet may run on its own when a real trigger is present.',
  ],
  [
    'R21',
    'Chain guard',
    'The policy’s chain must match the chain the executor is on. Mainnet is locked unless explicitly enabled.',
  ],
  [
    'R22',
    'Continuous screening',
    'A recipient’s risk tier can change after you sign. The cap tightens automatically; you do not need to re-sign.',
  ],
];

const CEILINGS: [string, string][] = [
  ['Per transaction', '250,000 USDC'],
  ['Per rolling 24 hours', '1,000,000 USDC'],
  ['Actions per hour', '20'],
  ['Allowlisted vaults', '5'],
  ['Recipients', '50'],
  ['Price age', '60 seconds'],
  ['Allow-receipt lifetime', '120 seconds'],
  ['Medium-risk recipient cap', '10,000 USDC per transaction'],
  ['High-risk recipient', 'Cannot be paid autonomously'],
];

const ERRORS: [string, string, string][] = [
  [
    '"is the treasury itself"',
    'A recipient has your own treasury address.',
    'Use the contributor’s own address.',
  ],
  [
    '"above the policy per-tx limit"',
    'A recipient’s cap is higher than the overall per-transaction limit.',
    'Lower the recipient’s cap or raise the per-transaction limit.',
  ],
  ['"already allowlisted"', 'The same vault was added twice.', 'Keep one.'],
  [
    '"does not compile cleanly"',
    'The mandate is missing a required number, such as a depeg or drawdown threshold, or a recipient breaks a limit.',
    'Read the message under the compile button, edit the text and compile again.',
  ],
  [
    '"already decided in the last 24h"',
    'The repeat guard (R17) is working.',
    'Change the amount or wait for the window to pass.',
  ],
  [
    'A payment is not sent',
    'Not due yet, the cash buffer would break, the wallet is frozen, or the agent wallet has no test USDC.',
    'Check the decision in Activity: it lists every rule and which one stopped it.',
  ],
];

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 pt-12 text-[26px] leading-8 font-bold tracking-tight text-ink"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 text-[17px] leading-6 font-semibold text-ink">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[15px] leading-7 text-muted">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[13px] text-ink">
      {children}
    </code>
  );
}

function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="mt-5 rounded-md border border-line-strong bg-accent-soft p-4">
      <p className="text-[13px] font-bold tracking-wide text-accent-ink uppercase">{title}</p>
      <p className="mt-1 text-[15px] leading-7 text-ink">{children}</p>
    </aside>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-4 space-y-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-7 text-muted">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-on-inverse">
            {i + 1}
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
        <thead className="bg-surface-2 text-[12px] tracking-wide text-muted uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`px-4 py-3 leading-6 ${j === 0 ? 'font-semibold text-ink' : 'text-muted'}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-ground">
      <header className="sticky top-0 z-30 border-b border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5" aria-label="Thesauros home">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent font-brand text-xl text-on-accent">
              T
            </span>
            <span className="font-brand text-[22px] tracking-wide text-ink">THESAUROS</span>
            <span className="ml-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-bold tracking-wide text-muted uppercase">
              Docs
            </span>
          </a>
          <a
            href="/connect"
            className="inline-flex min-h-9 items-center rounded-full bg-accent px-4 text-[13px] font-bold text-on-accent"
          >
            Open app
          </a>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Documentation" className="lg:sticky lg:top-20 lg:self-start lg:pt-12">
          <p className="label hidden lg:block">On this page</p>
          <ul className="flex gap-2 overflow-x-auto py-3 lg:mt-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-0">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#${s.id}`}
                  className="block rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-muted hover:text-ink lg:rounded-sm lg:bg-transparent lg:px-2 lg:py-1.5 lg:hover:bg-surface-2"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="min-w-0 max-w-3xl">
          <div className="pt-10">
            <p className="label">Documentation</p>
            <h1 className="mt-2 text-[40px] leading-[1.1] font-bold tracking-tight text-ink">
              The treasury that reconciles itself before it pays.
            </h1>
            <p className="mt-4 text-[17px] leading-8 text-muted">
              Everything you need to run Thesauros: what it does, how to set it up, which rules
              bound the agent, and what is and is not proven today.
            </p>
          </div>

          <H2 id="overview">Overview</H2>
          <P>
            Thesauros is an AI-operated business treasury on Arc, Circle’s stablecoin-native chain.
            You write a plain-English <strong className="text-ink">mandate</strong>. Thesauros
            compiles it into a machine <strong className="text-ink">policy</strong>, which you
            review and sign. From then on an agent keeps idle USDC productive, pays the recipients
            you approved on schedule, and screens every counterparty continuously, but only inside
            the rules you signed.
          </P>
          <P>
            The design principle is simple:{' '}
            <strong className="text-ink">reasoning proposes, deterministic code disposes.</strong> A
            model can suggest an action. It can never move funds by itself.
          </P>
          <Table
            head={['Capability', 'What it does']}
            rows={[
              [
                'Mandate to policy',
                'Turns plain English into explicit, signed limits and allowlists.',
              ],
              [
                'Scheduled payments',
                'Pays allowlisted recipients on their day of the month, with per-recipient caps.',
              ],
              [
                'Idle-cash yield',
                'Moves cash above your buffer into an allowlisted vault and brings it back when it is needed.',
              ],
              [
                'Continuous screening',
                'Re-checks every recipient on a schedule and tightens limits when risk changes.',
              ],
              [
                'Full audit trail',
                'Records every proposal, check, decision and transaction in an append-only log.',
              ],
              [
                'Owner always wins',
                'Freeze, revoke and sweep home work even when the AI or the backend is down.',
              ],
            ]}
          />

          <H2 id="how-it-works">How it works</H2>
          <P>Every action the agent takes follows the same pipeline. Each step can stop it.</P>
          <Steps
            items={[
              <>
                <strong className="text-ink">Gather.</strong> Plain code collects balances, due
                payments, prices and risk signals into a snapshot. The model never fetches its own
                data.
              </>,
              <>
                <strong className="text-ink">Propose.</strong> The reasoning layer suggests at most
                one action, or none. It has no tool that can sign or send.
              </>,
              <>
                <strong className="text-ink">Check.</strong> The Policy Engine runs the rules below.
                It is a pure function: no network, no clock, no randomness. The outcome is allow,
                ask you, or deny, and deny wins over ask, and ask wins over allow.
              </>,
              <>
                <strong className="text-ink">Simulate.</strong> The transaction is dry-run and the
                balance changes must match the proposal exactly.
              </>,
              <>
                <strong className="text-ink">Receipt.</strong> Only an allow produces a single-use,
                short-lived receipt.
              </>,
              <>
                <strong className="text-ink">Execute and confirm.</strong> One executor, and only
                it, holds the ability to act, and only with a valid receipt. Confirmation is read
                back from the chain.
              </>,
            ]}
          />
          <Callout title="Fail closed">
            An unknown action, a parse error, stale data or a thrown exception always ends in deny
            or do nothing. There is no path where a failure defaults to allow.
          </Callout>

          <H2 id="quick-start">Quick start</H2>
          <P>About fifteen minutes. Everything below runs on Arc testnet with free test USDC.</P>
          <Steps
            items={[
              <>
                <strong className="text-ink">Connect.</strong> Open the app and connect a browser
                wallet such as MetaMask. Signing in moves no money. If your wallet is on the wrong
                network, approve the switch to Arc Testnet.
              </>,
              <>
                <strong className="text-ink">Create your agent wallet.</strong> Setup creates a
                separate wallet for the agent. It is not your own wallet, and the agent can only
                spend what you put in it.
              </>,
              <>
                <strong className="text-ink">Write your mandate.</strong> Describe your limits and
                payments in plain sentences, then compile it and read the numbers it shows you.
              </>,
              <>
                <strong className="text-ink">Add recipients.</strong> Add each person with their
                wallet address and sign each one.
              </>,
              <>
                <strong className="text-ink">Sign the policy.</strong> Your signature makes the
                compiled policy the only rulebook the agent can follow.
              </>,
              <>
                <strong className="text-ink">Fund the agent wallet.</strong> Copy its address from
                the dashboard and request test USDC from the Circle faucet (choose Arc Testnet).
              </>,
              <>
                <strong className="text-ink">Watch it work.</strong> The agent checks the treasury
                on its own schedule. Open Activity to see each decision and the rules it passed.
              </>,
            ]}
          />

          <H2 id="mandate">Writing a mandate</H2>
          <P>
            A mandate is a few plain sentences. Say how much cash to keep liquid, how much the agent
            may move alone, when to ask you, and who gets paid when. Use your own numbers.
          </P>
          <blockquote className="mt-4 rounded-md border-l-4 border-accent bg-surface-2 p-4 text-[15px] leading-7 text-ink">
            Keep 5 USDC liquid. The agent may move up to 100 USDC per transaction and up to 500 USDC
            per day on its own. Ask me before anything of 150 USDC or more. Use a depeg threshold of
            50 basis points and a vault drawdown threshold of 100 basis points. Pay the hosting
            wallet 25 USDC on the 14th of each month. Pay the five members 95 USDC each on the 14th
            of each month.
          </blockquote>
          <H3>What a mandate sets</H3>
          <Table
            head={['Setting', 'Example wording', 'Effect']}
            rows={[
              [
                'Cash buffer',
                '“Keep 5 USDC liquid.”',
                'Money below this level is never moved out.',
              ],
              [
                'Per-transaction limit',
                '“up to 100 USDC per transaction”',
                'Largest single action the agent may take alone.',
              ],
              [
                'Daily limit',
                '“up to 500 USDC per day”',
                'Cap on outflows in any rolling 24 hours.',
              ],
              [
                'Approval threshold',
                '“Ask me before anything of 150 USDC or more.”',
                'At or above this, you approve.',
              ],
              [
                'Risk thresholds',
                '“depeg threshold of 50 basis points”',
                'When the agent exits a vault. Both must be set.',
              ],
              [
                'Schedules',
                '“Pay Asha 40 USDC on the 14th of each month.”',
                'Becomes a payment that falls due on that day.',
              ],
            ]}
          />
          <H3>Tips</H3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted marker:text-accent">
            <li>
              Compile, then <strong className="text-ink">read the numbers it shows</strong> before
              you sign. The compiled policy is what the agent obeys, not your sentences.
            </li>
            <li>A recipient’s own cap cannot be larger than the overall per-transaction limit.</li>
            <li>
              The mandate is compiled with your recipients and vaults. Add them first if compile
              says it does not compile cleanly.
            </li>
            <li>
              To change a rule, edit the mandate, compile and sign again. Earlier versions are kept.
            </li>
          </ul>

          <H2 id="guardrails">Guardrails</H2>
          <P>
            Twenty-three rules, R00 to R22, run on every proposal. They are ordinary code, not a
            model, so the same input always gives the same answer. Verdict precedence is{' '}
            <Code>DENY &gt; ESCALATE &gt; ALLOW</Code>.
          </P>
          <Table
            head={['Rule', 'Name', 'What it checks']}
            rows={RULES.map((r) => [r[0], r[1], r[2]])}
          />
          <H3>System ceilings</H3>
          <P>
            Fixed in code and not editable by any mandate. They hold even if the policy asks for
            more.
          </P>
          <Table head={['Limit', 'Value']} rows={CEILINGS.map((c) => [c[0], c[1]])} />

          <H2 id="payments">Payments and recipients</H2>
          <P>
            The agent can only pay people on your signed recipient list. Each recipient has a
            checksummed address, a chain, an optional per-transaction cap and an optional schedule.
          </P>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted marker:text-accent">
            <li>
              <strong className="text-ink">Exact match only.</strong> Destinations must match the
              allowlist by address and chain. Name lookups and similar-looking addresses are never
              used.
            </li>
            <li>
              <strong className="text-ink">Schedules.</strong> A day of the month (1 to 28) turns
              the recipient into a payment that falls due that day and again each month. Once it
              confirms on-chain it is marked paid.
            </li>
            <li>
              <strong className="text-ink">Continuous screening.</strong> Recipients are re-screened
              on a schedule. A medium-risk recipient is limited to 10,000 USDC per transaction. A
              high-risk recipient cannot be paid autonomously and needs your approval.
            </li>
            <li>
              <strong className="text-ink">Approvals.</strong> Anything above your threshold waits
              in Approvals. Nothing is sent until you sign.
            </li>
          </ul>

          <H2 id="yield">Idle cash and yield</H2>
          <P>
            Cash above your buffer can earn yield in an allowlisted vault. On Arc the vault is USYC,
            Circle’s yield-bearing money-market token. The agent deposits only what is idle and
            redeems what a cash-flow forecast says will be needed, including a partial redeem when
            only part is required.
          </P>
          <Callout title="USYC is permissioned">
            Circle only lets approved wallets deposit into USYC. Unless your agent wallet has been
            approved, do not add the USYC vault to your policy; the deposit would be refused.
            Payments work without it.
          </Callout>
          <P>
            On Arc, USDC is also the gas token, so the agent holds back a small reserve from every
            deposit and sweep to pay its own transaction fees.
          </P>

          <H2 id="activity">Activity and audit</H2>
          <P>
            Activity lists every decision the agent made, including the quiet ones. Open a decision
            to see the data it saw, what it proposed, each rule that ran and its result, the
            transaction link and the confirmation.
          </P>
          <P>
            Under the hood this is an append-only audit log: context snapshots, proposals,
            verifications, verdicts, executions, approvals, freezes and revocations. A database
            trigger blocks updates and deletes. A ledger can show that debits equal credits; this
            log shows <em>why</em> a payment was made, so a reviewer can replay the reasoning, not
            just the result.
          </P>

          <H2 id="owner-controls">Owner controls</H2>
          <Table
            head={['Control', 'What it does']}
            rows={[
              ['Freeze', 'Stops the agent immediately. Nothing executes until you unfreeze.'],
              ['Revoke', 'Withdraws the agent’s authority.'],
              [
                'Sweep home',
                'Moves everything in the agent wallet back to your treasury. Only you can trigger it.',
              ],
              ['Approvals', 'Lists anything that needs your signature before it can run.'],
            ]}
          />
          <P>
            These controls never call the AI layer, so they work even if the reasoning service, the
            model or the worker is down.
          </P>

          <H2 id="security">Security model</H2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted marker:text-accent">
            <li>
              <strong className="text-ink">Reasoning never touches funds.</strong> Only the executor
              can perform a write action, and only with a valid, unexpired, unused receipt.
            </li>
            <li>
              <strong className="text-ink">The model gets no write tools.</strong> Data gathering is
              plain code, and nothing that can sign or send is ever passed to a model.
            </li>
            <li>
              <strong className="text-ink">The policy engine is pure.</strong> No network, no model,
              no clock, no randomness. It is tested against an adversarial corpus of injection and
              misuse attempts.
            </li>
            <li>
              <strong className="text-ink">Non-custodial by design.</strong> The agent has its own
              wallet and can only spend what you place there, within your signed limits. Your
              treasury and keys stay with you.
            </li>
            <li>
              <strong className="text-ink">Idempotent.</strong> Each execution is keyed by its
              proposal, and each receipt can be used once, so a retry can never double-pay.
            </li>
            <li>
              <strong className="text-ink">Secrets stay secret.</strong> Keys are kept out of logs,
              prompts and API responses.
            </li>
          </ul>

          <H2 id="testnet">Testnet and limits</H2>
          <Callout title="Current status">
            Thesauros runs on Arc testnet with free test USDC. No real funds are at risk. Mainnet is
            locked behind an explicit sign-off and is off by default.
          </Callout>
          <P>What this means in practice:</P>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted marker:text-accent">
            <li>
              The first pilot was one small team on testnet. Six scheduled payments totalling 500
              test USDC confirmed on-chain and can be checked on the Arc explorer. It is a start,
              not a claim of scale.
            </li>
            <li>The live service may take a moment to wake after a period of inactivity.</li>
            <li>
              Cross-chain payments through CCTP and Gateway, and EURC, are not part of the current
              release.
            </li>
            <li>Yield figures in any report are estimates at an assumed rate, not results.</li>
          </ul>

          <H2 id="troubleshooting">Troubleshooting</H2>
          <Table
            head={['What you see', 'What it means', 'What to do']}
            rows={ERRORS.map((e) => [e[0], e[1], e[2]])}
          />

          <div className="mt-14 rounded-md bg-ink p-6 text-on-inverse">
            <p className="text-[18px] font-semibold">Ready to try it?</p>
            <p className="mt-1 text-[15px] leading-7 text-minor">
              Connect a wallet, write a mandate and watch the agent work on testnet.
            </p>
            <a
              href="/connect"
              className="mt-4 inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-[14px] font-bold text-on-accent"
            >
              Open the app
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
