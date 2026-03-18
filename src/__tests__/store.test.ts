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
