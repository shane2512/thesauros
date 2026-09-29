// UI copy for the mandate step: the example text each template chip drops into the textarea.
export const TEMPLATE_CHIPS = [
  {
    value: 'startup',
    label: 'Startup',
    text: 'Keep 120,000 USDC liquid. Put the rest in an approved vault. Pay the team on schedule. Ask me before anything over 15,000 USDC.',
  },
  {
    value: 'dao',
    label: 'DAO',
    text: 'Keep 500,000 USDC liquid. Put the rest in an approved vault. Every payout needs my signature. Ask me before anything over 50,000 USDC.',
  },
  {
    value: 'creator',
    label: 'Creator',
    text: 'Keep 5,000 USDC liquid. Put the rest in an approved vault. Pay my collaborators on schedule. Ask me before anything over 1,000 USDC.',
  },
] as const;

export type TemplateValue = (typeof TEMPLATE_CHIPS)[number]['value'] | 'custom';

export const isExampleText = (text: string): boolean =>
  TEMPLATE_CHIPS.some((c) => c.text === text.trim());
