import type { ReactNode } from 'react';
import { Geist_Mono, Plus_Jakarta_Sans, Space_Grotesk, UnifrakturCook } from 'next/font/google';
import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';

// Space Grotesk sets headlines and money, Plus Jakarta Sans everything else, Geist Mono only machine
// data (addresses, hashes, tx ids). UnifrakturCook is the brand's blackletter, used for the
// wordmark and nothing else — the same mark the landing page carries.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600', '700'],
  variable: '--font-grotesk',
});

const blackletter = UnifrakturCook({
  subsets: ['latin'],
  display: 'swap',
  weight: '700',
  variable: '--font-unifraktur',
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
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${spaceGrotesk.variable} ${blackletter.variable} ${geistMono.variable}`}
    >
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
