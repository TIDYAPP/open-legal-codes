import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodeStore } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { createDb } from '../store/db.js';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Fixture-based tests — always run, verify store loads and returns data
// ---------------------------------------------------------------------------

let db: Database.Database;
let store: CodeStore;

const fixtureJurisdictions = [
  {
    id: 'test-city-a',
    name: 'Test City A, TS',
    type: 'city' as const,
    state: 'TS',
    parentId: null,
    fips: null,
    publisher: { name: 'municode' as const, sourceId: '1', url: 'https://example.com' },
    lastCrawled: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  },
  {
    id: 'test-city-b',
    name: 'Test City B, TS',
    type: 'city' as const,
    state: 'TS',
    parentId: null,
    fips: null,
    publisher: { name: 'amlegal' as const, sourceId: '2', url: 'https://example.com' },
    lastCrawled: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  },
  {
    id: 'test-skeleton',
    name: 'Skeleton City, SK',
    type: 'city' as const,
    state: 'SK',
    parentId: null,
    fips: null,
    publisher: { name: 'municode' as const, sourceId: '3', url: 'https://example.com' },
    lastCrawled: '',
    lastUpdated: '',
  },
  {
    id: 'test-empty-toc',
    name: 'Empty Toc City, ET',
    type: 'city' as const,
    state: 'ET',
    parentId: null,
    fips: null,
    publisher: { name: 'municode' as const, sourceId: '4', url: 'https://example.com' },
    lastCrawled: '',
    lastUpdated: '',
  },
];

beforeAll(async () => {
  db = createDb(':memory:');
  const writer = new CodeWriter(db);

  // Insert jurisdictions
  for (const j of fixtureJurisdictions) {
    await writer.updateRegistry(j as any);
  }

  // Write TOC for test-city-a (one chapter)
  await writer.writeToc('test-city-a', {
    jurisdiction: 'test-city-a',
    title: 'Code of Test City A',
    children: [
      { slug: 'chapter-1', path: 'chapter-1', heading: 'Chapter 1', num: '1', level: 'chapter' as any, hasContent: false, children: [] },
    ],
  });

  // Write TOC for test-city-b (one chapter)
  await writer.writeToc('test-city-b', {
    jurisdiction: 'test-city-b',
    title: 'Code of Test City B',
    children: [
      { slug: 'chapter-1', path: 'chapter-1', heading: 'Chapter 1', num: '1', level: 'chapter' as any, hasContent: false, children: [] },
    ],
  });

  // test-skeleton: jurisdiction exists but has NO toc_nodes
  // test-empty-toc: jurisdiction exists but has NO toc_nodes

  store = new CodeStore(db);
});

afterAll(() => {
  db?.close();
});

describe('CodeStore (fixture)', () => {
  it('loads jurisdictions that have TOC data', () => {
    const all = store.listJurisdictions();
    expect(all.length).toBe(2);
    expect(all.map(j => j.id).sort()).toEqual(['test-city-a', 'test-city-b']);
  });

  it('excludes skeleton entries without TOC', () => {
    // test-skeleton has a jurisdiction row but no toc_nodes
    const all = store.listJurisdictions();
    expect(all.find(j => j.id === 'test-skeleton')).toBeUndefined();
  });

  it('excludes entries with no TOC nodes', () => {
    const all = store.listJurisdictions();
    expect(all.find(j => j.id === 'test-empty-toc')).toBeUndefined();
    expect(store.getToc('test-empty-toc')).toBeUndefined();
    expect(store.hasUsableToc('test-empty-toc')).toBe(false);
  });

  it('returns jurisdiction by ID (even without TOC)', () => {
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
    const tp = store.listJurisdictions({ publisher: 'municode' });
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
// Search tests with FTS5
// ---------------------------------------------------------------------------

describe('CodeStore search (FTS5)', () => {
  let searchDb: Database.Database;
  let searchStore: CodeStore;

  beforeAll(async () => {
    searchDb = createDb(':memory:');
    const writer = new CodeWriter(searchDb);

    await writer.updateRegistry({
      id: 'test-search',
      name: 'Test Search City',
      type: 'city',
      state: 'TS',
      parentId: null,
      fips: null,
      publisher: { name: 'municode' as any, sourceId: '1', url: '' },
      lastCrawled: '',
      lastUpdated: '',
    } as any);

    await writer.writeToc('test-search', {
      jurisdiction: 'test-search',
      title: 'Test Code',
      children: [
        { slug: 'section-1', path: 'section-1', level: 'section' as any, num: 'Section 1', heading: 'Parking Regulations', hasContent: true },
        { slug: 'section-2', path: 'section-2', level: 'section' as any, num: 'Section 2', heading: 'Zoning Rules', hasContent: true },
        { slug: 'section-3', path: 'section-3', level: 'section' as any, num: 'Section 3', heading: 'Dog Control', hasContent: true },
      ],
    });

    await writer.writeSection('test-search', 'section-1', '<xml/>', '<p>No parking allowed on Main Street between 8am and 6pm.</p>');
    await writer.writeSection('test-search', 'section-2', '<xml/>', '<p>Residential zoning permits single-family homes only.</p>');
    await writer.writeSection('test-search', 'section-3', '<xml/>', '<p>All dogs must be leashed in public parks.</p>');

    searchStore = new CodeStore(searchDb);
  });

  afterAll(() => {
    searchDb?.close();
  });

  it('finds sections containing a keyword', () => {
    const results = searchStore.search('test-search', 'parking');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('path');
    expect(results[0]).toHaveProperty('num');
    expect(results[0]).toHaveProperty('heading');
    expect(results[0]).toHaveProperty('snippet');
  });

  it('returns empty for nonsense keyword', () => {
    const results = searchStore.search('test-search', 'xyzzy123nonsense');
    expect(results).toEqual([]);
  });

  it('respects limit parameter', () => {
    const results = searchStore.search('test-search', 'Section', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty for unknown jurisdiction', () => {
    const results = searchStore.search('nonexistent', 'test');
    expect(results).toEqual([]);
  });

  it('hasSearchIndex returns true for jurisdictions with sections', () => {
    expect(searchStore.hasSearchIndex('test-search')).toBe(true);
  });

  it('hasSearchIndex returns false for unknown jurisdiction', () => {
    expect(searchStore.hasSearchIndex('nonexistent')).toBe(false);
  });

  it('getCodeText returns plain text from DB', () => {
    const text = searchStore.getCodeText('test-search', 'section-1');
    expect(text).toBeDefined();
    expect(text).toContain('parking');
    // Should NOT contain HTML tags
    expect(text).not.toContain('<p>');
  });
});

// ---------------------------------------------------------------------------
// Multi-code tests
// ---------------------------------------------------------------------------

describe('CodeStore multi-code', () => {
  let mcDb: Database.Database;
  let mcStore: CodeStore;

  beforeAll(async () => {
    mcDb = createDb(':memory:');
    const writer = new CodeWriter(mcDb);

    await writer.updateRegistry({
      id: 'test-multicode',
      name: 'Multi-Code City',
      type: 'city',
      state: 'TS',
      parentId: null,
      fips: null,
      publisher: { name: 'municode' as any, sourceId: '99', url: '' },
      lastCrawled: '',
      lastUpdated: '',
    } as any);

    // Write two codes
    writer.writeCodes('test-multicode', [
      { codeId: 'code-of-ordinances', name: 'Code of Ordinances', sourceId: '100', sourceUrl: null, isPrimary: true, sortOrder: 0, lastCrawled: '', lastUpdated: '' },
      { codeId: 'land-development', name: 'Land Development Code', sourceId: '101', sourceUrl: null, isPrimary: false, sortOrder: 1, lastCrawled: '', lastUpdated: '' },
    ]);

    // Write TOC for code-of-ordinances
    await writer.writeToc('test-multicode', {
      jurisdiction: 'test-multicode',
      title: 'Code of Ordinances',
      children: [
        { slug: 'chapter-1', path: 'chapter-1', level: 'chapter' as any, num: 'Chapter 1', heading: 'General', hasContent: true },
      ],
    }, 'code-of-ordinances');

    // Write TOC for land-development
    await writer.writeToc('test-multicode', {
      jurisdiction: 'test-multicode',
      title: 'Land Development Code',
      children: [
        { slug: 'article-1', path: 'article-1', level: 'article' as any, num: 'Article 1', heading: 'Zoning', hasContent: true },
      ],
    }, 'land-development');

    // Write sections
    await writer.writeSection('test-multicode', 'chapter-1', '<xml/>', '<p>General ordinance text about parking.</p>', 'code-of-ordinances');
    await writer.writeSection('test-multicode', 'article-1', '<xml/>', '<p>Zoning and land use regulations.</p>', 'land-development');

    mcStore = new CodeStore(mcDb);
  });

  afterAll(() => {
    mcDb?.close();
  });

  it('listCodes returns all codes for a jurisdiction', () => {
    const codes = mcStore.listCodes('test-multicode');
    expect(codes).toHaveLength(2);
    expect(codes[0].codeId).toBe('code-of-ordinances');
    expect(codes[0].isPrimary).toBe(true);
    expect(codes[1].codeId).toBe('land-development');
    expect(codes[1].isPrimary).toBe(false);
  });

  it('listCodes returns empty for unknown jurisdiction', () => {
    expect(mcStore.listCodes('nonexistent')).toEqual([]);
  });

  it('resolveCodeId returns primary code when none specified', () => {
    const resolved = mcStore.resolveCodeId('test-multicode');
    expect(resolved).toBe('code-of-ordinances');
  });

  it('resolveCodeId returns specified code when provided', () => {
    const resolved = mcStore.resolveCodeId('test-multicode', 'land-development');
    expect(resolved).toBe('land-development');
  });

  it('getToc returns correct TOC for each code', () => {
    const ordinancesToc = mcStore.getToc('test-multicode', 'code-of-ordinances');
    expect(ordinancesToc).toBeDefined();
    expect(ordinancesToc!.children[0].num).toBe('Chapter 1');

    const ldcToc = mcStore.getToc('test-multicode', 'land-development');
    expect(ldcToc).toBeDefined();
    expect(ldcToc!.children[0].num).toBe('Article 1');
  });

  it('getToc defaults to primary code', () => {
    const toc = mcStore.getToc('test-multicode');
    expect(toc).toBeDefined();
    expect(toc!.children[0].num).toBe('Chapter 1');
  });

  it('getCodeText returns text for specific code', () => {
    const text = mcStore.getCodeText('test-multicode', 'article-1', 'land-development');
    expect(text).toContain('Zoning');
  });

  it('getCodeText defaults to primary code', () => {
    const text = mcStore.getCodeText('test-multicode', 'chapter-1');
    expect(text).toContain('parking');
  });

  it('search scoped to specific code', () => {
    const results = mcStore.search('test-multicode', 'zoning', undefined, 'land-development');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('article-1');
  });

  it('invalidateCache can scope to specific code', () => {
    // Create a separate db to test invalidation without affecting other tests
    const invDb = createDb(':memory:');
    const invWriter = new CodeWriter(invDb);

    invWriter.updateRegistry({
      id: 'test-inv',
      name: 'Inv City',
      type: 'city',
      state: 'TS',
      parentId: null,
      fips: null,
      publisher: { name: 'municode' as any, sourceId: '1', url: '' },
      lastCrawled: '',
      lastUpdated: '',
    } as any);

    invWriter.writeCodes('test-inv', [
      { codeId: 'code-a', name: 'Code A', sourceId: null, sourceUrl: null, isPrimary: true, sortOrder: 0, lastCrawled: '', lastUpdated: '' },
      { codeId: 'code-b', name: 'Code B', sourceId: null, sourceUrl: null, isPrimary: false, sortOrder: 1, lastCrawled: '', lastUpdated: '' },
    ]);

    invWriter.writeToc('test-inv', {
      jurisdiction: 'test-inv',
      title: 'Code A',
      children: [{ slug: 's1', path: 's1', level: 'section' as any, num: 'S1', heading: 'A', hasContent: true }],
    }, 'code-a');

    invWriter.writeToc('test-inv', {
      jurisdiction: 'test-inv',
      title: 'Code B',
      children: [{ slug: 's1', path: 's1', level: 'section' as any, num: 'S1', heading: 'B', hasContent: true }],
    }, 'code-b');

    const invStore = new CodeStore(invDb);

    // Invalidate only code-a
    invStore.invalidateCache('test-inv', 'code-a');

    // code-a TOC should be gone
    expect(invStore.getToc('test-inv', 'code-a')).toBeUndefined();
    // code-b TOC should remain
    expect(invStore.getToc('test-inv', 'code-b')).toBeDefined();

    invDb.close();
  });
});
