import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { jurisdictionsRoutes } from '../routes/jurisdictions.js';
import { tocRoutes } from '../routes/toc.js';
import { codeRoutes } from '../routes/code.js';
import { searchRoutes } from '../routes/search.js';
import { lookupRoutes } from '../routes/lookup.js';
import { store } from '../store/index.js';
import { crawlTracker } from '../crawl-tracker.js';

// Initialize store before tests
beforeAll(() => {
  store.initialize();
});

// Build a test app matching server.ts
const app = new Hono();
const api = new Hono();
api.route('/jurisdictions', jurisdictionsRoutes);
api.route('/jurisdictions', tocRoutes);
api.route('/jurisdictions', codeRoutes);
api.route('/jurisdictions', searchRoutes);
api.route('/lookup', lookupRoutes);
app.route('/api/v1', api);

async function fetch(path: string) {
  return app.request(`http://localhost${path}`);
}

describe('GET /api/v1/jurisdictions', () => {
  it('returns list of jurisdictions', async () => {
    const res = await fetch('/api/v1/jurisdictions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta.timestamp).toBeDefined();
  });

  it('filters by state', async () => {
    const res = await fetch('/api/v1/jurisdictions?state=CA');
    const body = await res.json();
    expect(body.data.every((j: any) => j.state === 'CA')).toBe(true);
  });
});

describe('GET /api/v1/jurisdictions/:id', () => {
  it('returns single jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('ca-mountain-view');
    expect(body.data.name).toBe('Mountain View, CA');
  });

  it('returns 404 for unknown jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/jurisdictions/:id/toc', () => {
  it('returns full TOC', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/toc');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.jurisdiction).toBe('ca-mountain-view');
    expect(body.data.children.length).toBeGreaterThan(0);
  });

  it('limits depth', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/toc?depth=1');
    const body = await res.json();
    for (const child of body.data.children) {
      expect(child.children).toEqual([]);
    }
  });

  it('returns 404 for unknown jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent/toc');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/jurisdictions/:id/code/*', () => {
  const section = 'part-i/article-i/section-100';

  it('returns plain text by default', async () => {
    const res = await fetch(`/api/v1/jurisdictions/ca-mountain-view/code/${section}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.text).toContain('Mountain View');
    expect(body.data.jurisdiction).toBe('ca-mountain-view');
    expect(body.data.jurisdictionName).toBe('Mountain View, CA');
    expect(body.data.path).toBe(section);
  });

  it('returns XML when format=xml', async () => {
    const res = await fetch(`/api/v1/jurisdictions/ca-mountain-view/code/${section}?format=xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const text = await res.text();
    expect(text).toContain('<?xml');
  });

  it('returns HTML when format=html', async () => {
    const res = await fetch(`/api/v1/jurisdictions/ca-mountain-view/code/${section}?format=html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('returns 404 for unknown path', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent/code/anything');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/jurisdictions/:id/search', () => {
  it('returns results for a known term', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/search?q=Mountain+View');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.query).toBe('Mountain View');
    expect(body.data.jurisdiction).toBe('ca-mountain-view');
    expect(body.data.results.length).toBeGreaterThan(0);
    expect(body.data.results[0]).toHaveProperty('path');
    expect(body.data.results[0]).toHaveProperty('snippet');
  });

  it('returns empty results for nonsense term', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/search?q=xyzzy123nonsense');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('returns 404 for unknown jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent/search?q=test');
    expect(res.status).toBe(404);
  });

  it('returns 400 when q is missing', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/search');
    expect(res.status).toBe(400);
  });

  it('respects limit parameter', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/search?q=the&limit=3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.length).toBeLessThanOrEqual(3);
  });
});

describe('GET /api/v1/lookup', () => {
  it('finds jurisdiction by city and state', async () => {
    const res = await fetch('/api/v1/lookup?city=Mountain+View&state=CA');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ready');
    expect(body.data.id).toBe('ca-mountain-view');
  });

  it('returns 400 with no params', async () => {
    const res = await fetch('/api/v1/lookup');
    expect(res.status).toBe(400);
  });
});

describe('202 CRAWL_IN_PROGRESS responses', () => {
  afterEach(() => {
    crawlTracker.finish('ca-mountain-view');
  });

  it('returns 202 for code request when crawl is active', async () => {
    // Simulate an active crawl — tracker is active but path not yet cached
    crawlTracker.start('ca-mountain-view');
    crawlTracker.updateProgress('ca-mountain-view', {
      phase: 'sections',
      total: 300,
      completed: 42,
      errors: [],
    });

    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent-path');
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('CRAWL_IN_PROGRESS');
    expect(body.progress.phase).toBe('sections');
    expect(body.progress.total).toBe(300);
    expect(body.progress.completed).toBe(42);
    expect(body.retryAfter).toBe(30);
    expect(body.startedAt).toBeDefined();
  });

  it('returns 202 for XML code request when crawl is active', async () => {
    crawlTracker.start('ca-mountain-view');

    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent-path?format=xml');
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('CRAWL_IN_PROGRESS');
  });

  it('returns 202 for HTML code request when crawl is active', async () => {
    crawlTracker.start('ca-mountain-view');

    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent-path?format=html');
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('CRAWL_IN_PROGRESS');
  });

  it('still returns 404 for unknown jurisdiction even during crawl', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent/code/anything');
    expect(res.status).toBe(404);
  });

  it('still returns 404 for missing path when no crawl is active', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent-path');
    expect(res.status).toBe(404);
  });

  it('returns 200 for cached data even when crawl is active', async () => {
    crawlTracker.start('ca-mountain-view');

    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view/code/part-i/article-i/section-100');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.text).toBeDefined();
  });
});
