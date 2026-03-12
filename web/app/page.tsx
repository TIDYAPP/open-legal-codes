'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RegistryEntry } from '@/lib/api';
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
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/registry`)
      .then((r) => r.json())
      .then((data) => setEntries(data.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  // Count jurisdictions per state + federal
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    let federal = 0;
    for (const e of entries) {
      if (e.type === 'federal') federal++;
      else if (e.state) m[e.state] = (m[e.state] || 0) + 1;
    }
    return { byState: m, federal };
  }, [entries]);

  // Search: filter entries by name, show direct results
  const searchResults = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return entries
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [entries, search]);

  const totalCount = entries.length;

  return (
    <div className="page">
      <h1>Codes</h1>
      <p className="subtitle">
        Browse and search US legal codes.
        {!loading && totalCount > 0 && (
          <span> {totalCount.toLocaleString()} jurisdictions available.</span>
        )}
      </p>

      <div className="search-bar">
        <input
          type="search"
          placeholder="Search jurisdictions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : searchResults ? (
        // Search results mode
        <div>
          <div className="text-sm text-muted mb-16">
            {searchResults.length === 0
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
        // Browse mode: Federal + 50 states
        <>
          {counts.federal > 0 && (
            <a href="/browse/federal" className="browse-card">
              <span className="browse-card-name">Federal</span>
              <span className="browse-card-count">{counts.federal}</span>
            </a>
          )}
          <div className="browse-grid">
            {ALL_STATES.map(([code, name]) => (
              <a key={code} href={`/browse/${code}`} className="browse-card">
                <span className="browse-card-name">{name}</span>
                {counts.byState[code] && (
                  <span className="browse-card-count">{counts.byState[code]}</span>
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
