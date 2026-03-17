import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { CodeStore } from '../store/index.js';

// ---------------------------------------------------------------------------
// Fixture-based tests — always run, verify store loads and returns cached data
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(process.cwd(), 'codes', '__test-fixtures__');

const fixtureJurisdictions = [
  {
    id: 'test-city-a',
    name: 'Test City A, TS',
    type: 'city',
    state: 'TS',
    parentId: null,
    fips: null,
    publisher: { name: 'test-pub', sourceId: '1', url: 'https://example.com' },
    lastCrawled: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  },
  {
    id: 'test-city-b',
    name: 'Test City B, TS',
    type: 'city',
    state: 'TS',
    parentId: null,
    fips: null,
    publisher: { name: 'other-pub', sourceId: '2', url: 'https://example.com' },
    lastCrawled: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  },
  {
    id: 'test-skeleton',
    name: 'Skeleton City, SK',
    type: 'city',
    state: 'SK',
    parentId: null,
    fips: null,
    publisher: { name: 'test-pub', sourceId: '3', url: 'https://example.com' },
    lastCrawled: '',
    lastUpdated: '',
  },
  {
    id: 'test-empty-toc',
    name: 'Empty Toc City, ET',
    type: 'city',
    state: 'ET',
    parentId: null,
    fips: null,
    publisher: { name: 'test-pub', sourceId: '4', url: 'https://example.com' },
    lastCrawled: '',
    lastUpdated: '',
  },
];

const fixtureToc = {
  jurisdiction: 'test-city-a',
  title: 'Code of Test City A',
  children: [
    { id: 'chapter-1', path: 'chapter-1', heading: 'Chapter 1', num: '1', type: 'chapter', children: [] },
  ],
};

beforeAll(() => {
  // Create fixture directory and write jurisdictions.json
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(join(FIXTURE_DIR, 'jurisdictions.json'), JSON.stringify(fixtureJurisdictions));

  // Create test-city-a with _toc.json (properly cached)
  const cityADir = join(FIXTURE_DIR, 'test-city-a');
  mkdirSync(cityADir, { recursive: true });
  writeFileSync(join(cityADir, '_toc.json'), JSON.stringify(fixtureToc));

  // Create test-city-b with _toc.json (properly cached)
  const cityBDir = join(FIXTURE_DIR, 'test-city-b');
  mkdirSync(cityBDir, { recursive: true });
  writeFileSync(join(cityBDir, '_toc.json'), JSON.stringify({ ...fixtureToc, jurisdiction: 'test-city-b' }));

  // test-skeleton has NO _toc.json — simulates the bug scenario
  const emptyTocDir = join(FIXTURE_DIR, 'test-empty-toc');
  mkdirSync(emptyTocDir, { recursive: true });
  writeFileSync(join(emptyTocDir, '_toc.json'), JSON.stringify({
    jurisdiction: 'test-empty-toc',
    title: 'Code of Empty Toc City',
    children: [],
  }));
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe('CodeStore (fixture)', () => {
  const store = new CodeStore(FIXTURE_DIR);

  beforeAll(() => {
    store.initialize();
  });

  it('loads jurisdictions that have _toc.json', () => {
    const all = store.listJurisdictions();
    expect(all.length).toBe(2);
    expect(all.map(j => j.id).sort()).toEqual(['test-city-a', 'test-city-b']);
  });

  it('excludes skeleton entries without _toc.json', () => {
    expect(store.getJurisdiction('test-skeleton')).toBeUndefined();
  });

  it('excludes entries whose _toc.json is present but empty', () => {
    expect(store.getJurisdiction('test-empty-toc')).toBeUndefined();
    expect(store.getToc('test-empty-toc')).toBeUndefined();
    expect(store.hasUsableToc('test-empty-toc')).toBe(false);
  });

  it('returns jurisdiction by ID', () => {
    const j = store.getJurisdiction('test-city-a');
    expect(j).toBeDefined();
    expect(j!.name).toBe('Test City A, TS');
  });

  it('returns TOC for cached jurisdiction', () => {
    const toc = store.getToc('test-city-a');
    expect(toc).toBeDefined();
    expect(toc!.children.length).toBe(1);
    expect(toc!.children[0].heading).toBe('Chapter 1');
    expect(store.hasUsableToc('test-city-a')).toBe(true);
  });

  it('filters by state', () => {
    const ts = store.listJurisdictions({ state: 'TS' });
    expect(ts.length).toBe(2);
    expect(ts.every(j => j.state === 'TS')).toBe(true);
  });

  it('filters by publisher', () => {
    const tp = store.listJurisdictions({ publisher: 'test-pub' });
    expect(tp.length).toBe(1);
    expect(tp[0].id).toBe('test-city-a');
  });

  it('returns empty for nonexistent state', () => {
    expect(store.listJurisdictions({ state: 'ZZ' })).toEqual([]);
  });

  it('returns undefined for unknown ID', () => {
    expect(store.getJurisdiction('nonexistent')).toBeUndefined();
  });

  it('returns undefined TOC for unknown jurisdiction', () => {
    expect(store.getToc('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Real-data tests — only run when actual cached data is present on disk
// ---------------------------------------------------------------------------

const CODES_DIR = join(process.cwd(), 'codes');
const hasCachedData = existsSync(join(CODES_DIR, 'ca-mountain-view', '_toc.json'));

describe.skipIf(!hasCachedData)('CodeStore (real data)', () => {
  const store = new CodeStore(CODES_DIR);
  store.initialize();

  it('returns all jurisdictions when no filters', () => {
    const all = store.listJurisdictions();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by state', () => {
    const ca = store.listJurisdictions({ state: 'CA' });
    expect(ca.length).toBeGreaterThanOrEqual(1);
    expect(ca.every((j) => j.state === 'CA')).toBe(true);
  });

  it('filters by publisher', () => {
    const municode = store.listJurisdictions({ publisher: 'municode' });
    expect(municode.length).toBeGreaterThanOrEqual(1);
    expect(municode.every((j) => j.publisher.name === 'municode')).toBe(true);
  });

  it('returns jurisdiction by ID', () => {
    const j = store.getJurisdiction('ca-mountain-view');
    expect(j).toBeDefined();
    expect(j!.name).toBe('Mountain View, CA');
  });

  it('returns TOC tree for crawled jurisdiction', () => {
    const toc = store.getToc('ca-mountain-view');
    expect(toc).toBeDefined();
    expect(toc!.jurisdiction).toBe('ca-mountain-view');
    expect(toc!.children.length).toBeGreaterThan(0);
  });

  it('returns plain text for a section', () => {
    const text = store.getCodeText('ca-mountain-view', 'part-i/article-i/section-100');
    expect(text).toBeDefined();
    expect(text).toContain('Mountain View');
  });

  it('returns null for nonexistent path', () => {
    expect(store.getCodeText('ca-mountain-view', 'nonexistent')).toBeNull();
  });

  it('returns null for nonexistent jurisdiction', () => {
    expect(store.getCodeText('nonexistent', 'anything')).toBeNull();
  });

  it('returns XML content', () => {
    const xml = store.getCodeXml('ca-mountain-view', 'part-i/article-i/section-100');
    expect(xml).toBeDefined();
    expect(xml).toContain('<?xml');
    expect(xml).toContain('lawDoc');
  });

  it('returns original HTML content', () => {
    const html = store.getCodeHtml('ca-mountain-view', 'part-i/article-i/section-100');
    expect(html).toBeDefined();
    expect(html).toContain('<');
  });
});
