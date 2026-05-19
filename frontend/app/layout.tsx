import './globals.css';
import { Inter, Fraunces } from 'next/font/google';
import { Providers } from './providers';
import { KillServiceWorker } from '@/components/KillServiceWorker';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-display' });

export const metadata = {
  title: 'Elevate Dental OS',
  description: 'Run your dental group like a CEO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="bg-bg text-ink font-sans antialiased">
        <KillServiceWorker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
