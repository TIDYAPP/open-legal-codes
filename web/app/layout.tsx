import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Open Legal Codes',
  description: 'Free, open-source access to US legal codes. Built for AI agents.',
};

const NAV = [
  { href: '/', label: 'Codes' },
  { href: '/map', label: 'Map' },
  { href: '/agents', label: 'Agents' },
  { href: '/developers', label: 'Developers' },
  { href: '/faq', label: 'FAQ' },
  { href: '/terms', label: 'Terms' },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <a href="/" className="nav-logo">Open Legal Codes</a>
            <div className="nav-links">
              {NAV.map((item) => (
                <a key={item.href} href={item.href}>{item.label}</a>
              ))}
            </div>
          </div>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
