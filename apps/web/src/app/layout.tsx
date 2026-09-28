import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';
import { Providers } from './providers';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Alora Health',
  description: 'Home health agency management',
  // Staff dashboard with patient data — keep it out of search engines.
  robots: { index: false, follow: false },
};

/**
 * Every page renders per request so it carries the nonce from the Content-Security-Policy (proxy.ts, D-068).
 * The pages are signed-in client apps anyway — nothing here benefits from static prerendering.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
