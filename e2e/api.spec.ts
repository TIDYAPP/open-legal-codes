import { test, expect } from '@playwright/test';

// --- Registry ---

test.describe('Registry API', () => {
  test('GET /api/v1/registry/stats returns stats', async ({ request }) => {
    const res = await request.get('/api/v1/registry/stats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBeGreaterThan(0);
    expect(body.data.byPublisher).toBeDefined();
    expect(body.data.byState).toBeDefined();
  });

  test('GET /api/v1/registry returns entries', async ({ request }) => {
    const res = await request.get('/api/v1/registry?limit=5');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('name');
  });

  test('GET /api/v1/registry/geo returns geo entries', async ({ request }) => {
    const res = await request.get('/api/v1/registry/geo');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('lat');
    expect(body.data[0]).toHaveProperty('lng');
  });
});

// --- Lookup ---

test.describe('Lookup API', () => {
  test('finds Mountain View by slug and state', async ({ request }) => {
    const res = await request.get('/api/v1/lookup?slug=mountain-view&state=CA');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ready');
    expect(body.data.id).toBe('ca-mountain-view');
  });

  test('returns 400 with no params', async ({ request }) => {
    const res = await request.get('/api/v1/lookup');
    expect(res.status()).toBe(400);
  });

  test('returns not_found for nonexistent jurisdiction', async ({ request }) => {
    const res = await request.get('/api/v1/lookup?slug=nonexistent&state=ZZ');
    const body = await res.json();
    expect(body.data.status).toBe('not_found');
  });
});

// --- TOC ---

test.describe('TOC API', () => {
  test('returns TOC for Mountain View (Municode)', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/toc');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.jurisdiction).toBe('ca-mountain-view');
    expect(body.data.children.length).toBeGreaterThan(0);
  });

  test('depth=1 limits children', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/toc?depth=1');
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const child of body.data.children) {
      expect(child.children).toEqual([]);
    }
  });

  test('registry includes multiple publishers', async ({ request }) => {
    const res = await request.get('/api/v1/registry/stats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const publishers = Object.keys(body.data.byPublisher);
    expect(publishers.length).toBeGreaterThan(1);
    expect(publishers).toContain('municode');
  });

  test('returns 404 for unknown jurisdiction', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/nonexistent/toc');
    expect(res.status()).toBe(404);
  });
});

// --- Code ---

test.describe('Code API', () => {
  const section = 'part-i/article-i/section-100';

  test('returns plain text for Mountain View section', async ({ request }) => {
    const res = await request.get(`/api/v1/jurisdictions/ca-mountain-view/code/${section}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.text).toBeTruthy();
    expect(body.data.path).toBe(section);
    expect(body.data.url).toBeTruthy();
  });

  test('returns HTML when format=html', async ({ request }) => {
    const res = await request.get(`/api/v1/jurisdictions/ca-mountain-view/code/${section}?format=html`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });

  test('returns 404 for nonexistent path', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/code/nonexistent');
    expect(res.status()).toBe(404);
  });

  test('returns 404 for unknown jurisdiction', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/nonexistent/code/anything');
    expect(res.status()).toBe(404);
  });
});

// --- Search ---

test.describe('Search API', () => {
  test('returns results for "parking"', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/search?q=parking');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.results.length).toBeGreaterThan(0);
    expect(body.data.results[0]).toHaveProperty('path');
    expect(body.data.results[0]).toHaveProperty('snippet');
    expect(body.data.results[0]).toHaveProperty('url');
  });

  test('returns empty results for nonsense query', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/search?q=xyzzy123nonsense');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.results).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  test('returns 400 when q is missing', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/search');
    expect(res.status()).toBe(400);
  });

  test('respects limit parameter', async ({ request }) => {
    const res = await request.get('/api/v1/jurisdictions/ca-mountain-view/search?q=the&limit=3');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.results.length).toBeLessThanOrEqual(3);
  });
});
