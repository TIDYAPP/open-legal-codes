'use client';

import { useState } from 'react';

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

  if (!jurisdiction) {
    params.then((p) => setJurisdiction(p.jurisdiction));
    return null;
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
    <div className="page">
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        <a href={`/${jurisdiction}`}>{jurisdiction}</a>
        <span className="sep">/</span>
        <span>Search</span>
      </div>

      <h1>Search</h1>

      <form onSubmit={handleSearch} className="search-bar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for keywords..."
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? '...' : 'Search'}
        </button>
      </form>

      {searched && (
        <div>
          {results.length === 0 ? (
            <p className="text-muted">No results for &quot;{query}&quot;</p>
          ) : (
            <>
              <p className="text-xs text-faint mb-8">{results.length} results</p>
              <div className="list">
                {results.map((r) => (
                  <a key={r.path} href={`/${jurisdiction}/${r.path}`}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>
                      {r.num}{r.heading ? ` — ${r.heading}` : ''}
                    </div>
                    <div className="text-xs text-faint mt-8">{r.path}</div>
                    {r.snippet && <div className="text-sm text-muted mt-8">{r.snippet}</div>}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
