'use client';

import { use, useState, useEffect } from 'react';
import { useJurisdiction } from '@/lib/jurisdiction-context';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function CodePage({
  params,
}: {
  params: Promise<{ state: string; slug: string; path: string[] }>;
}) {
  const { path } = use(params);
  const codePath = path.join('/');
  const { id, name, urlBase } = useJurisdiction();

  const [code, setCode] = useState<{ text: string; num: string | null; heading: string | null; url?: string } | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/api/v1/jurisdictions/${id}/code/${codePath}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => setCode(data.data))
      .catch(() => setError(true));
  }, [id, codePath]);

  const copyLink = () => {
    const url = code?.url || window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (error) {
    return (
      <div>
        <p>Section not found. <a href={urlBase || '/'}>Back to table of contents</a></p>
      </div>
    );
  }

  if (!code) {
    return <div><p className="text-muted">Loading...</p></div>;
  }

  return (
    <div>
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        <a href={urlBase || '/'}>{name}</a>
        <span className="sep">/</span>
        <span>{codePath}</span>
      </div>

      {code.num && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ margin: 0 }}>{code.num}{code.heading ? ` \u2014 ${code.heading}` : ''}</h1>
          <button
            onClick={copyLink}
            className="copy-link-btn"
            title="Copy permalink"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}

      <div className="section-text">{code.text}</div>
    </div>
  );
}
