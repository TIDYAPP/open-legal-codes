import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { jurisdictionsRoutes } from '../routes/jurisdictions.js';
import { tocRoutes } from '../routes/toc.js';
import { codeRoutes } from '../routes/code.js';
import { searchRoutes } from '../routes/search.js';
import { lookupRoutes } from '../routes/lookup.js';
import { store } from '../store/index.js';
import { registryStore } from '../registry/store.js';
import { crawlTracker } from '../crawl-tracker.js';

const hasCachedData = existsSync(join(process.cwd(), 'codes', 'ca-mountain-view', '_toc.json'));
let uncachedRegistryId: string | undefined;

// Initialize store before tests
beforeAll(() => {
  store.initialize();
  registryStore.initialize();
  uncachedRegistryId = registryStore.query().find((entry) => !store.getJurisdiction(entry.id))?.id;
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
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    expect(body.meta.limit).toBeDefined();
    expect(body.meta.offset).toBeDefined();
  });

  it('filters by state', async () => {
    const res = await fetch('/api/v1/jurisdictions?state=CA');
    const body = await res.json();
    expect(body.data.every((j: any) => j.state === 'CA')).toBe(true);
  });
});

describe('GET /api/v1/jurisdictions/:id', () => {
  it.skipIf(!hasCachedData)('returns single jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/ca-mountain-view');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('ca-mountain-view');
    expect(body.data.name).toBe('Mountain View, CA');
  });

  it.skipIf(!uncachedRegistryId)('returns registry metadata for a known uncached jurisdiction', async () => {
    const res = await fetch(`/api/v1/jurisdictions/${uncachedRegistryId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(uncachedRegistryId);
    expect(body.data.publisher).toHaveProperty('name');
    expect(body.data.publisher).toHaveProperty('sourceId');
    expect(body.data.publisher).toHaveProperty('url');
    expect(['available', 'cached', 'discoverable', 'crawling']).toContain(body.data.status);
  });

  it('returns 404 for unknown jurisdiction', async () => {
    const res = await fetch('/api/v1/jurisdictions/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!hasCachedData)('GET /api/v1/jurisdictions/:id/toc', () => {
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

describe.skipIf(!hasCachedData)('GET /api/v1/jurisdictions/:id/code/*', () => {
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

describe.skipIf(!hasCachedData)('GET /api/v1/jurisdictions/:id/search', () => {
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
  it.skipIf(!hasCachedData)('finds jurisdiction by city and state', async () => {
    const res = await fetch('/api/v1/lookup?city=Mountain+View&state=CA');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ready');
    expect(body.data.id).toBe('ca-mountain-view');
  });

  it('resolves Travis County without falling through to not_found', async () => {
    const res = await fetch('/api/v1/lookup?county=Travis+County&state=TX');
    expect([200, 202]).toContain(res.status);
    const body = await res.json();
    expect(body.data.id).toBe('tx-travis-county');
    expect(['ready', 'crawling']).toContain(body.data.status);
  });

  it('resolves Maricopa County without falling through to not_found', async () => {
    const res = await fetch('/api/v1/lookup?county=Maricopa+County&state=AZ');
    expect([200, 202]).toContain(res.status);
    const body = await res.json();
    expect(body.data.id).toBe('az-maricopa-county');
    expect(['ready', 'crawling']).toContain(body.data.status);
  });

  it('returns 400 with no params', async () => {
    const res = await fetch('/api/v1/lookup');
    expect(res.status).toBe(400);
  });
});

describe('empty cached TOC auto-recovery', () => {
  const testId = 'ts-auto-recrawl-city';
  const testEntry = {
    id: testId,
    name: 'Auto Recrawl City, TS',
    type: 'city' as const,
    state: 'TS',
    fips: '99999',
    lat: null,
    lng: null,
    population: null,
    publisher: 'unknown',
    sourceId: 'auto-recrawl-city',
    sourceUrl: 'https://example.com/auto-recrawl-city',
    status: 'available' as const,
    censusMatch: null,
    lastScanned: '',
  };
  const cachedJurisdiction = {
    id: testId,
    name: testEntry.name,
    type: testEntry.type,
    state: testEntry.state,
    parentId: null,
    fips: testEntry.fips,
    publisher: { name: 'manual' as const, sourceId: testId, url: testEntry.sourceUrl },
    lastCrawled: '2026-03-17T00:00:00.000Z',
    lastUpdated: '2026-03-17T00:00:00.000Z',
  };

  afterEach(() => {
    crawlTracker.finish(testId);
    const jurisdictions = (store as any).jurisdictions as Map<string, unknown>;
    const tocTrees = (store as any).tocTrees as Map<string, unknown>;
    const entries = (registryStore as any).entries as Array<{ id: string }>;
    const byId = (registryStore as any).byId as Map<string, unknown>;
    const byState = (registryStore as any).byState as Map<string, Array<{ id: string }>>;
    const byPublisher = (registryStore as any).byPublisher as Map<string, Array<{ id: string }>>;
    const bySlug = (registryStore as any).bySlug as Map<string, unknown>;

    jurisdictions.delete(testId);
    tocTrees.delete(testId);
    (registryStore as any).entries = entries.filter((entry) => entry.id !== testId);
    byId.delete(testId);
    bySlug.delete('ts-auto-recrawl-city');
    byState.set('TS', (byState.get('TS') || []).filter((entry) => entry.id !== testId));
    byPublisher.set('unknown', (byPublisher.get('unknown') || []).filter((entry) => entry.id !== testId));
  });

  it('treats cached jurisdictions with empty TOCs as crawlable instead of ready', async () => {
    const jurisdictions = (store as any).jurisdictions as Map<string, unknown>;
    const tocTrees = (store as any).tocTrees as Map<string, unknown>;

    jurisdictions.set(testId, cachedJurisdiction);
    tocTrees.set(testId, {
      jurisdiction: testId,
      title: 'Auto Recrawl City Code',
      children: [],
    });
    registryStore.addEntry(testEntry);

    const lookupRes = await fetch('/api/v1/lookup?city=Auto+Recrawl+City&state=TS');
    expect(lookupRes.status).toBe(202);
    const lookupBody = await lookupRes.json();
    expect(lookupBody.data.id).toBe(testId);
    expect(lookupBody.data.status).toBe('crawling');

    const metadataRes = await fetch(`/api/v1/jurisdictions/${testId}`);
    expect(metadataRes.status).toBe(200);
    const metadataBody = await metadataRes.json();
    expect(['available', 'crawling']).toContain(metadataBody.data.status);
    expect(metadataBody.data.status).not.toBe('cached');

    const cachedListRes = await fetch('/api/v1/jurisdictions?cached=true&state=TS');
    expect(cachedListRes.status).toBe(200);
    const cachedListBody = await cachedListRes.json();
    expect(cachedListBody.data.map((entry: any) => entry.id)).not.toContain(testId);

    const tocRes = await fetch(`/api/v1/jurisdictions/${testId}/toc`);
    expect(tocRes.status).toBe(202);
    const tocBody = await tocRes.json();
    expect(tocBody.status).toBe('CRAWL_IN_PROGRESS');
  });
});

describe.skipIf(!hasCachedData)('202 CRAWL_IN_PROGRESS responses', () => {
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
