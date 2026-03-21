'use client';

import { use, useState, useEffect } from 'react';
import { useJurisdiction } from '@/lib/jurisdiction-context';
import type { CaseLawResult, CaseLawResponse, Annotation } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function CodePage({
  params,
}: {
  params: Promise<{ state: string; slug: string; path: string[] }>;
}) {
  const { path } = use(params);
  const codePath = path.join('/');
  const { id, name, urlBase } = useJurisdiction();

  const [code, setCode] = useState<{ text: string; html?: string; num: string | null; heading: string | null; level?: string | null; url?: string } | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const isSection = !code?.level || code.level === 'section';

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/api/v1/jurisdictions/${id}/code/${codePath}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        const d = data.data;
        setCode(d);
        // For non-section pages, also fetch HTML to preserve structure
        if (d.level && d.level !== 'section') {
          fetch(`${API_BASE}/api/v1/jurisdictions/${id}/code/${codePath}?format=html`)
            .then(r => r.ok ? r.text() : null)
            .then(html => { if (html) setCode(prev => prev ? { ...prev, html } : prev); });
        }
      })
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

      {!isSection && code.html ? (
        <div className="section-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(code.html) }} />
      ) : (
        <div className="section-text">{code.text}</div>
      )}

      {id && isSection && <CaseLawSection jurisdictionId={id} codePath={codePath} />}
      {id && isSection && <AnnotationsSection jurisdictionId={id} codePath={codePath} />}
      {id && isSection && <AddAnnotationForm jurisdictionId={id} codePath={codePath} />}
      {id && <ReportIssueButton jurisdictionId={id} codePath={codePath} />}
    </div>
  );
}

function CaseLawSection({ jurisdictionId, codePath }: { jurisdictionId: string; codePath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<CaseLawResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const fetchCaseLaw = (newOffset: number) => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/v1/jurisdictions/${jurisdictionId}/caselaw/${codePath}?limit=${limit}&offset=${newOffset}`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(json => {
        const result = json.data as CaseLawResponse;
        if (newOffset === 0) {
          setData(result);
        } else {
          setData(prev => prev ? { ...result, cases: [...prev.cases, ...result.cases] } : result);
        }
        setOffset(newOffset);
      })
      .catch(err => {
        if (err.message === '503') {
          setError('Case law search requires a CourtListener API token. Contact the site administrator.');
        } else {
          setError('Failed to load case law.');
        }
      })
      .finally(() => setLoading(false));
  };

  const handleExpand = () => {
    if (!expanded && !data) {
      fetchCaseLaw(0);
    }
    setExpanded(!expanded);
  };

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--border, #ddd)', paddingTop: 16 }}>
      <button
        onClick={handleExpand}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 16,
          fontWeight: 600,
          padding: '4px 0',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
          &#9654;
        </span>
        Citing Court Opinions
        {data && data.supported && (
          <span style={{ fontWeight: 400, fontSize: 14, opacity: 0.7 }}>
            ({data.totalCount.toLocaleString()})
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {loading && !data && <p className="text-muted">Searching CourtListener...</p>}

          {error && <p style={{ color: 'var(--error, #c00)' }}>{error}</p>}

          {data && !data.supported && (
            <p className="text-muted">{data.note}</p>
          )}

          {data && data.supported && data.citationQueries.length > 0 && (
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Searching for: {data.citationQueries.join(', ')}
            </p>
          )}

          {data && data.supported && data.cases.length === 0 && !loading && (
            <p className="text-muted">No citing opinions found.</p>
          )}

          {data && data.cases.map((c: CaseLawResult) => (
            <div key={c.clusterId} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-light, #eee)' }}>
              <div>
                <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                  {c.caseName}
                </a>
              </div>
              <div style={{ fontSize: 14, opacity: 0.8, marginTop: 2 }}>
                {c.court} &middot; {c.dateFiled}
                {c.citation && <> &middot; {c.citation}</>}
                {c.citeCount > 0 && <> &middot; cited by {c.citeCount} opinions</>}
              </div>
              {c.snippet && (
                <div
                  style={{ fontSize: 13, marginTop: 6, opacity: 0.7 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeSnippet(c.snippet) }}
                />
              )}
            </div>
          ))}

          {data && data.supported && data.cases.length < data.totalCount && (
            <button
              onClick={() => fetchCaseLaw(offset + limit)}
              disabled={loading}
              style={{
                padding: '8px 16px',
                cursor: loading ? 'wait' : 'pointer',
                border: '1px solid var(--border, #ddd)',
                background: 'var(--bg-secondary, #f5f5f5)',
                borderRadius: 4,
              }}
            >
              {loading ? 'Loading...' : `Load more (${data.cases.length} of ${data.totalCount.toLocaleString()})`}
            </button>
          )}

          {data && data.supported && data.cases.length > 0 && (
            <p style={{ fontSize: 12, marginTop: 12, opacity: 0.5 }}>
              Case law sourced from <a href="https://www.courtlistener.com" target="_blank" rel="noopener noreferrer">CourtListener</a> (Free Law Project). Links to full opinions — we do not host case law.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Allow only <mark> and <em> tags from CourtListener snippets. */
function sanitizeSnippet(html: string): string {
  return html.replace(/<\/?(?!mark\b|em\b)[^>]+>/gi, '');
}

/** Sanitize and transform container page HTML for safe rendering. */
function sanitizeHtml(html: string): string {
  // Strip the leading h1 (already rendered by the page heading)
  let cleaned = html.replace(/<h1[\s>][\s\S]*?<\/h1>/i, '');
  // Strip href from <a> tags — publisher links don't work in our app
  cleaned = cleaned.replace(/<a\b[^>]*>/gi, '<a>');
  // Allow only safe structural tags
  const allowed = /^\/?(div|a|h[2-6]|p|ul|ol|li|span|br|small|table|tr|td|th|thead|tbody|strong|b|em|i)\b/i;
  cleaned = cleaned.replace(/<\/?([^>]+)>/gi, (match, inner) => {
    if (allowed.test(inner.trim())) return match;
    return ' ';
  });
  return cleaned;
}

const ANNOTATION_TYPE_LABELS: Record<string, string> = {
  legal_analysis: 'Legal Analysis',
  government_guidance: 'Government Guidance',
  academic: 'Academic',
  news: 'News',
  other: 'Other',
};

function AnnotationsSection({ jurisdictionId, codePath }: { jurisdictionId: string; codePath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<Annotation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const limit = 50;

  const fetchAnnotations = (newOffset: number) => {
    setLoading(true);
    fetch(`${API_BASE}/api/v1/jurisdictions/${jurisdictionId}/annotations/${codePath}?limit=${limit}&offset=${newOffset}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (!json) return;
        const rows = json.data as Annotation[];
        if (newOffset === 0) {
          setData(rows);
        } else {
          setData(prev => prev ? [...prev, ...rows] : rows);
        }
        setOffset(newOffset);
        setHasMore(rows.length === limit);
      })
      .finally(() => setLoading(false));
  };

  const handleExpand = () => {
    if (!expanded && !data) {
      fetchAnnotations(0);
    }
    setExpanded(!expanded);
  };

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--border, #ddd)', paddingTop: 16 }}>
      <button
        onClick={handleExpand}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 16,
          fontWeight: 600,
          padding: '4px 0',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
          &#9654;
        </span>
        Legal Analysis &amp; Commentary
        {data && data.length > 0 && (
          <span style={{ fontWeight: 400, fontSize: 14, opacity: 0.7 }}>({data.length})</span>
        )}
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {loading && !data && <p className="text-muted">Loading...</p>}

          {data && data.length === 0 && !loading && (
            <p className="text-muted">No external references yet.</p>
          )}

          {data && data.map((a: Annotation) => (
            <div key={a.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border-light, #eee)' }}>
              <div>
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                  {a.title}
                </a>
              </div>
              <div style={{ fontSize: 14, opacity: 0.8, marginTop: 2 }}>
                {a.source_name && <>{a.source_name} &middot; </>}
                <span style={{
                  display: 'inline-block',
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--bg-secondary, #f0f0f0)',
                  opacity: 0.9,
                }}>
                  {ANNOTATION_TYPE_LABELS[a.annotation_type] || a.annotation_type}
                </span>
                {' '}&middot; {new Date(a.created_at).toLocaleDateString()}
              </div>
              {a.description && (
                <div style={{ fontSize: 13, marginTop: 6, opacity: 0.7 }}>{a.description}</div>
              )}
            </div>
          ))}

          {data && hasMore && (
            <button
              onClick={() => fetchAnnotations(offset + limit)}
              disabled={loading}
              style={{
                padding: '8px 16px',
                cursor: loading ? 'wait' : 'pointer',
                border: '1px solid var(--border, #ddd)',
                background: 'var(--bg-secondary, #f5f5f5)',
                borderRadius: 4,
              }}
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          )}

          {data && data.length > 0 && (
            <p style={{ fontSize: 12, marginTop: 12, opacity: 0.5 }}>
              Community-submitted references to external legal analysis. Not legal advice.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddAnnotationForm({ jurisdictionId, codePath }: { jurisdictionId: string; codePath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [annotationType, setAnnotationType] = useState('legal_analysis');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/jurisdictions/${jurisdictionId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: codePath,
          url,
          title,
          sourceName: sourceName || undefined,
          annotationType,
          description: description || undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || `Error: ${res.status}`);
      }
      const json = await res.json();
      const status = json.data.status;
      setResult({
        type: 'success',
        message: status === 'approved'
          ? 'Submitted and approved! It will appear shortly.'
          : 'Submitted for review. Annotations from trusted sources appear immediately; others after moderation.',
      });
      setUrl('');
      setTitle('');
      setSourceName('');
      setDescription('');
      setAnnotationType('legal_analysis');
    } catch (err: any) {
      setResult({ type: 'error', message: err.message || 'Failed to submit. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => { setExpanded(!expanded); setResult(null); }}
        style={{
          background: 'none',
          border: '1px solid var(--border, #ddd)',
          borderRadius: 4,
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--text-secondary, #666)',
        }}
      >
        Add a reference
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} style={{ marginTop: 12, maxWidth: 480 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>URL *</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
              placeholder="https://..."
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              maxLength={500}
              placeholder="Article or document title"
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Source name</label>
            <input
              type="text"
              value={sourceName}
              onChange={e => setSourceName(e.target.value)}
              placeholder="e.g. Latham & Watkins (auto-detected for known domains)"
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Type</label>
            <select
              value={annotationType}
              onChange={e => setAnnotationType(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4 }}
            >
              <option value="legal_analysis">Legal Analysis</option>
              <option value="government_guidance">Government Guidance</option>
              <option value="academic">Academic</option>
              <option value="news">News</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Note (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="Brief description of the resource..."
              rows={2}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4, resize: 'vertical' }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '6px 16px',
              fontSize: 14,
              cursor: submitting ? 'wait' : 'pointer',
              border: '1px solid var(--border, #ddd)',
              background: 'var(--bg-secondary, #f5f5f5)',
              borderRadius: 4,
            }}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
          {result && (
            <p style={{
              marginTop: 8,
              fontSize: 13,
              color: result.type === 'success' ? 'green' : 'var(--error, #c00)',
            }}>
              {result.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function ReportIssueButton({ jurisdictionId, codePath }: { jurisdictionId: string; codePath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [reportType, setReportType] = useState('bad_citation');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await fetch(`${API_BASE}/api/v1/jurisdictions/${jurisdictionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: codePath, reportType, description }),
      }).then(r => {
        if (!r.ok) throw new Error();
      });
      setResult('success');
      setDescription('');
      setTimeout(() => { setExpanded(false); setResult(null); }, 3000);
    } catch {
      setResult('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <button
        onClick={() => { setExpanded(!expanded); setResult(null); }}
        style={{
          background: 'none',
          border: '1px solid var(--border, #ddd)',
          borderRadius: 4,
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--text-secondary, #666)',
        }}
      >
        Report an issue
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} style={{ marginTop: 12, maxWidth: 480 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Issue type</label>
            <select
              value={reportType}
              onChange={e => setReportType(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4 }}
            >
              <option value="bad_citation">Bad citation</option>
              <option value="out_of_date">Out of date</option>
              <option value="wrong_text">Wrong text</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="Describe what's wrong..."
              rows={3}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--border, #ddd)', borderRadius: 4, resize: 'vertical' }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '6px 16px',
              fontSize: 14,
              cursor: submitting ? 'wait' : 'pointer',
              border: '1px solid var(--border, #ddd)',
              background: 'var(--bg-secondary, #f5f5f5)',
              borderRadius: 4,
            }}
          >
            {submitting ? 'Submitting...' : 'Submit report'}
          </button>
          {result === 'success' && (
            <span style={{ marginLeft: 12, color: 'green', fontSize: 13 }}>Thanks! Report submitted.</span>
          )}
          {result === 'error' && (
            <span style={{ marginLeft: 12, color: 'var(--error, #c00)', fontSize: 13 }}>Failed to submit. Please try again.</span>
          )}
        </form>
      )}
    </div>
  );
}
