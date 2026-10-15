// UI copy for the mandate step: the example text each template chip drops into the textarea.
// The same samples are shown, with explanations, on the public /docs page (#mandate).
export const SAMPLE_MANDATES = [
  {
    value: 'small',
    label: 'Small',
    title: 'Small, faucet-sized',
    blurb: 'Best if you only have a few testnet USDC.',
    text: 'Keep 20 USDC liquid. The agent may move up to 8 USDC per transaction and up to 8 USDC per day on its own. Ask me for approval before anything over 4 USDC per transaction. Use a depeg threshold of 50 bps and a vault drawdown threshold of 100 bps.',
  },
  {
    value: 'mid',
    label: 'Mid-size',
    title: 'Mid-size treasury',
    blurb: 'A team treasury with room to run on its own.',
    text: 'Keep 10,000 USDC liquid at all times. The agent may move up to 2,000 USDC per transaction and up to 5,000 USDC per day on its own, across at most 10 actions per hour. Ask me before anything over 3,000 USDC. Use a depeg threshold of 100 bps and a vault drawdown threshold of 300 bps.',
  },
  {
    value: 'strict',
    label: 'Strict',
    title: 'Strict, low autonomy',
    blurb: 'The fastest way to see the approval flow.',
    text: 'Keep 1,000 USDC liquid. The agent may move up to 10 USDC per transaction and up to 20 USDC per day on its own. Ask me before anything over 10 USDC. Use a depeg threshold of 50 bps and a vault drawdown threshold of 100 bps.',
  },
  {
    value: 'solo',
    label: 'Solo founder',
    title: 'Creator or solo founder',
    blurb: 'One owner, a moderate buffer, and room for routine payments.',
    text: 'Keep 5,000 USDC liquid at all times. The agent may move up to 500 USDC per transaction and up to 1,000 USDC per day on its own. Ask me before anything over 1,000 USDC. Use a depeg threshold of 100 bps and a vault drawdown threshold of 300 bps.',
  },
] as const;

export type TemplateValue = (typeof SAMPLE_MANDATES)[number]['value'] | 'custom';

export const isExampleText = (text: string): boolean =>
  SAMPLE_MANDATES.some((c) => c.text === text.trim());

/** The docs section that explains how to draft a mandate. */
export const MANDATE_DOCS_HREF = '/docs#mandate';
