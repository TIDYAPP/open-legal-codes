'use client';

import { useState, useEffect, useCallback } from 'react';
import { JurisdictionContext, type JurisdictionData } from '@/lib/jurisdiction-context';
import { lookupJurisdiction } from '@/lib/api';
import { use } from 'react';

export default function JurisdictionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ state: string; slug: string }>;
}) {
  const { state, slug } = use(params);
  const [data, setData] = useState<JurisdictionData>({ status: 'loading' });

  const doLookup = useCallback(async () => {
    try {
      const result = await lookupJurisdiction(state, slug, { toc: false });
      setData(result);
    } catch {
      setData({ status: 'not_found' });
    }
  }, [state, slug]);

  useEffect(() => {
    doLookup();
  }, [doLookup]);

  // Poll when crawling
  useEffect(() => {
    if (data.status !== 'crawling') return;
    const interval = setInterval(doLookup, 12000);
    return () => clearInterval(interval);
  }, [data.status, doLookup]);

  if (data.status === 'loading') {
    return <div><p className="text-muted">Loading...</p></div>;
  }

  if (data.status === 'not_found') {
    return (
      <div>
        <p>{data.message || 'Jurisdiction not found.'} <a href="/">Back to home</a></p>
      </div>
    );
  }

  if (data.status === 'crawling') {
    const pct = data.progress && data.progress.total > 0
      ? Math.round((data.progress.completed / data.progress.total) * 100)
      : 0;
    return (
      <div>
        <h1>{data.name || 'Loading...'}</h1>
        <p className="text-muted">
          Fetching legal codes... This may take a few minutes.
        </p>
        {data.progress && data.progress.total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: '#eee', borderRadius: 4, height: 8, maxWidth: 400 }}>
              <div style={{ background: '#333', borderRadius: 4, height: 8, width: `${pct}%`, transition: 'width 0.5s' }} />
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 8 }}>
              {data.progress.completed} / {data.progress.total} sections ({pct}%)
            </p>
          </div>
        )}
        <p className="text-sm text-faint" style={{ marginTop: 16 }}>
          This page will automatically refresh.
        </p>
      </div>
    );
  }

  return (
    <JurisdictionContext.Provider value={{ ...data, urlBase: `/${state.toLowerCase()}/${slug}` }}>
      {children}
    </JurisdictionContext.Provider>
  );
}
