import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Thesauros',
  description: 'The treasury that reconciles itself before it pays.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
