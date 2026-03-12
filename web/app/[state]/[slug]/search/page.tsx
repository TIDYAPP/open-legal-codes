'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useJurisdiction } from '@/lib/jurisdiction-context';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
}

export default function SearchPage() {
  const { id, name, urlBase } = useJurisdiction();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !id) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/jurisdictions/${id}/search?q=${encodeURIComponent(q)}&limit=50`);
      const data = await res.json();
      setResults(data.data?.results || []);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, [id]);

  // Auto-search if ?q= is present in URL
  useEffect(() => {
    if (initialQuery && id) {
      doSearch(initialQuery);
    }
  }, [initialQuery, id, doSearch]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    doSearch(query);
  }

  return (
    <div>
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        <a href={urlBase || '/'}>{name}</a>
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
                  <a key={r.path} href={`${urlBase}/${r.path}`}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>
                      {r.num}{r.heading ? ` \u2014 ${r.heading}` : ''}
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
