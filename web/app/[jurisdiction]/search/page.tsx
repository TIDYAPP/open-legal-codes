'use client';

import { useState } from 'react';
import { AgentBanner } from '@/components/agent-banner';

interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
}

export default function SearchPage({
  params,
}: {
  params: Promise<{ jurisdiction: string }>;
}) {
  const [jurisdiction, setJurisdiction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Resolve params
  if (!jurisdiction) {
    params.then((p) => setJurisdiction(p.jurisdiction));
    return <p>Loading...</p>;
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/v1/jurisdictions/${jurisdiction}/search?q=${encodeURIComponent(query)}&limit=50`);
      const data = await res.json();
      setResults(data.data?.results || []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="breadcrumbs mb-4">
        <a href="/">Jurisdictions</a>
        <span className="separator">/</span>
        <a href={`/${jurisdiction}`}>{jurisdiction}</a>
        <span className="separator">/</span>
        <span className="text-gray-900">Search</span>
      </div>

      <h1 className="text-xl font-semibold mb-4">Search {jurisdiction}</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for keywords (e.g. rental, parking, dog)"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <AgentBanner />

      {searched && (
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <p className="text-gray-500">No results found for &quot;{query}&quot;.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">{results.length} sections found</p>
              {results.map((r) => (
                <a
                  key={r.path}
                  href={`/${jurisdiction}/${r.path}`}
                  className="card block"
                  style={{ textDecoration: 'none' }}
                >
                  <div className="font-medium text-sm">
                    {r.num}{r.heading ? ` — ${r.heading}` : ''}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{r.path}</div>
                  <div className="text-sm text-gray-700 mt-2">{r.snippet}</div>
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
