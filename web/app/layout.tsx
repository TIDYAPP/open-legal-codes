import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Open Legal Codes',
  description: 'Browse US legal codes. Free, open source, machine-readable.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <a href="/" className="text-lg font-semibold text-gray-900 hover:text-blue-700">
              Open Legal Codes
            </a>
            <div className="flex gap-4 text-sm">
              <a href="/" className="text-gray-600 hover:text-gray-900">Browse</a>
              <a href="/agents" className="text-gray-600 hover:text-gray-900">Use with AI</a>
              <a
                href="https://github.com/mchusma/open-legal-codes"
                className="text-gray-600 hover:text-gray-900"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
        <footer className="border-t border-gray-200 mt-12 py-6 px-6">
          <div className="max-w-5xl mx-auto text-sm text-gray-500">
            <p>
              The text of the law is public domain.{' '}
              <a href="https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc." className="underline" target="_blank" rel="noopener noreferrer">
                Georgia v. Public.Resource.Org (2020)
              </a>
            </p>
            <p className="mt-1">
              This tool is also available as a{' '}
              <a href="/agents" className="underline">CLI, REST API, and MCP server</a>{' '}
              for AI agents.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
