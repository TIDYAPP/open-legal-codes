'use client';

import { useState, useCallback } from 'react';
import { useJurisdiction } from '@/lib/jurisdiction-context';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface TocNode {
  slug: string;
  path: string;
  num: string;
  heading: string;
  hasContent: boolean;
  children?: TocNode[];
}

interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
}

function TocTree({ nodes, baseUrl }: { nodes: TocNode[]; baseUrl: string }) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path} className="toc-node">
          <div>
            {node.hasContent ? (
              <a href={`${baseUrl}/${node.path}`}>
                <span className="text-faint text-sm">{node.num}</span>{' '}
                {node.heading}
              </a>
            ) : (
              <span className="no-content">
                <strong>{node.num}</strong>
                {node.heading && <span className="text-muted"> &mdash; {node.heading}</span>}
              </span>
            )}
          </div>
          {node.children && node.children.length > 0 && (
            <div className="toc-children">
              <TocTree nodes={node.children} baseUrl={baseUrl} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function JurisdictionPage() {
  const { id, name, state, children, urlBase } = useJurisdiction();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const doSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !id) return;
    setSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/jurisdictions/${id}/search?q=${encodeURIComponent(query)}&limit=50`);
      const data = await res.json();
      setResults(data.data?.results || []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, [query, id]);

  const clearSearch = () => {
    setQuery('');
    setResults(null);
  };

  return (
    <div>
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        {state && <><a href={`/browse/${state}`}>{state}</a><span className="sep">/</span></>}
        <span>{name}</span>
      </div>

      <h1>{name}</h1>

      <form onSubmit={doSearch} className="search-bar">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value) clearSearch(); }}
          placeholder="Search this code..."
        />
        <button type="submit" disabled={searching}>
          {searching ? '...' : 'Search'}
        </button>
      </form>

      {results !== null ? (
        <div>
          <div className="text-sm text-muted mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{results.length === 0 ? `No results for "${query}"` : `${results.length} results`}</span>
            <a href="#" onClick={(e) => { e.preventDefault(); clearSearch(); }} className="text-sm">Clear</a>
          </div>
          <div className="list">
            {results.map((r) => (
              <a key={r.path} href={`${urlBase}/${r.path}`}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>
                  {r.num}{r.heading ? ` \u2014 ${r.heading}` : ''}
                </div>
                {r.snippet && <div className="text-sm text-muted mt-8">{r.snippet}</div>}
              </a>
            ))}
          </div>
        </div>
      ) : children && children.length > 0 ? (
        <TocTree nodes={children} baseUrl={urlBase || ''} />
      ) : (
        <p className="text-muted">No code sections available.</p>
      )}
    </div>
  );
}
