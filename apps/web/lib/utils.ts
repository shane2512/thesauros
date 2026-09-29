import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Our named type sizes (globals.css @theme) must merge as font sizes, not as text colours —
// otherwise `text-meta` would silently drop `text-on-accent` from a button.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'label',
            'mono',
            'small',
            'body',
            'h1',
            'h2',
            'h3',
            'balance',
            'balance-lg',
            'micro',
            'cap',
            'fine',
            'meta',
            'ui',
            'title',
            'lead',
            'section',
            'stat-sm',
            'headline',
            'stat',
            'amount',
            'display',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
