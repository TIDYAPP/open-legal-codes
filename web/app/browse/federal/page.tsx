'use client';

import { useState, useEffect, useMemo } from 'react';
import type { RegistryEntry } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export default function FederalPage() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/registry?type=federal`)
      .then((r) => r.json())
      .then((data) => setEntries(data.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => [...entries].sort((a, b) => a.name.localeCompare(b.name)), [entries]);

  return (
    <div className="page">
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        Federal
      </div>

      <h1>Federal Codes</h1>
      <p className="subtitle">{!loading && `${sorted.length} titles available.`}</p>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-muted">No federal codes in the registry.</p>
      ) : (
        <div className="list">
          {sorted.map((entry) => (
            <a key={entry.id} href={`/${entry.id}`}>
              <div className="card-title">{entry.name}</div>
              <div className="card-meta">
                {entry.publisher}
                {entry.status === 'cached' && <span className="entry-status cached"> &middot; cached</span>}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
