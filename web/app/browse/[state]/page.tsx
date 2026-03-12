'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
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

const TYPE_ORDER: Record<string, number> = { state: 0, county: 1, city: 2, hoa: 3 };
const TYPE_LABELS: Record<string, string> = { state: 'State Codes', county: 'Counties', city: 'Cities', hoa: 'HOAs' };

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function StatePage() {
  const params = useParams();
  const stateCode = (params.state as string).toUpperCase();
  const stateName = STATE_NAMES[stateCode] || stateCode;

  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/registry?state=${stateCode}`)
      .then((r) => r.json())
      .then((data) => setEntries(data.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [stateCode]);

  const grouped = useMemo(() => {
    const byType: Record<string, RegistryEntry[]> = {};
    for (const e of entries) {
      (byType[e.type] ||= []).push(e);
    }
    for (const list of Object.values(byType)) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    const types = Object.keys(byType).sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9));
    return { byType, types };
  }, [entries]);

  return (
    <div>
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        {stateName}
      </div>

      <h1>{stateName}</h1>
      <p className="subtitle">{!loading && `${entries.length} jurisdictions available.`}</p>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">No jurisdictions found for {stateName}.</p>
      ) : (
        grouped.types.map((type) => (
          <div key={type} className="mb-24">
            <div className="state-label">{TYPE_LABELS[type] || type}</div>
            <div className="list">
              {grouped.byType[type].map((entry) => (
                <a key={entry.id} href={jurisdictionUrl(entry)}>
                  <div className="card-title">
                    {entry.name}
                    {entry.status === 'cached' && <span className="badge">cached</span>}
                  </div>
                  <div className="card-meta">
                    {entry.population ? `pop. ${entry.population.toLocaleString()}` : entry.type}
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
