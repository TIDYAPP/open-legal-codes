'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RegistryEntry, RegistryStats } from '@/lib/api';
import { jurisdictionUrl } from '@/lib/urls';

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

const ALL_STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function CodesPage() {
  const [stats, setStats] = useState<RegistryStats | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<RegistryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Fetch lightweight stats on mount (< 1KB vs 300KB+ for full registry)
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/registry/stats`)
      .then((r) => r.json())
      .then((data) => setStats(data.data))
      .catch(() => {});
  }, []);

  // Debounced search — only fetches entries when user types
  useEffect(() => {
    if (!search) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/v1/registry?search=${encodeURIComponent(search)}&limit=50`)
        .then((r) => r.json())
        .then((data) => setSearchResults(data.data || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div>
      <h1>Codes</h1>
      <p className="subtitle">
        Browse and search US legal codes.
        {stats && <span> {stats.total.toLocaleString()} jurisdictions available.</span>}
      </p>

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search jurisdictions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {searchResults ? (
        <div>
          <div className="text-sm text-muted mb-16">
            {searching ? 'Searching...' :
              searchResults.length === 0
                ? `No jurisdictions match "${search}"`
                : `${searchResults.length}${searchResults.length === 50 ? '+' : ''} results`}
          </div>
          <div className="list">
            {searchResults.map((entry) => (
              <a key={entry.id} href={jurisdictionUrl(entry)}>
                <div className="card-title">{entry.name}</div>
                <div className="card-meta">
                  {entry.type} &middot; {entry.state || 'Federal'}
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : (
        <>
          {stats && stats.byType.federal > 0 && (
            <a href="/browse/federal" className="browse-card">
              <span className="browse-card-name">Federal</span>
              <span className="browse-card-count">{stats.byType.federal}</span>
            </a>
          )}
          <div className="browse-grid">
            {ALL_STATES.map(([code, name]) => (
              <a key={code} href={`/browse/${code}`} className="browse-card">
                <span className="browse-card-name">{name}</span>
                {stats?.byState[code] && (
                  <span className="browse-card-count">{stats.byState[code]}</span>
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
