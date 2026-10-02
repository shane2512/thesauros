import type { ReactNode } from 'react';
import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';

// The landing page's own pairing: Plus Jakarta Sans for everything, Geist Mono only for machine
// data (addresses, hashes, tx ids). Sukajan Brush (capitals only, no digits) is the brand's
// display face, used for the wordmark and nothing else — the same mark the landing page carries.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'Thesauros',
  description: 'The treasury that reconciles itself before it pays.',
  icons: { icon: '/logo/thesauros-logo.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-ground font-sans text-body text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-3 focus:text-on-accent"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
