import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodeStore } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { createDb } from '../store/db.js';
import type Database from 'better-sqlite3';

/**
 * FTS5 search tests.
 *
 * Uses an in-memory SQLite database with fixture data.
 * The old search-index.test.ts used real cached data from disk;
 * this version is self-contained and always runs.
 */

let db: Database.Database;
let store: CodeStore;

beforeAll(async () => {
  db = createDb(':memory:');
  const writer = new CodeWriter(db);

  await writer.updateRegistry({
    id: 'fts-test',
    name: 'FTS Test City, TS',
    type: 'city',
    state: 'TS',
    parentId: null,
    fips: null,
    publisher: { name: 'municode' as any, sourceId: '1', url: '' },
    lastCrawled: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  } as any);

  await writer.writeToc('fts-test', {
    jurisdiction: 'fts-test',
    title: 'FTS Test Code',
    children: [
      { slug: 'section-100', path: 'section-100', level: 'section' as any, num: 'Section 100', heading: 'General Provisions', hasContent: true },
      { slug: 'section-200', path: 'section-200', level: 'section' as any, num: 'Section 200', heading: 'Parking Regulations', hasContent: true },
      { slug: 'section-300', path: 'section-300', level: 'section' as any, num: 'Section 300', heading: 'Zoning Ordinance', hasContent: true },
      { slug: 'section-400', path: 'section-400', level: 'section' as any, num: 'Section 400', heading: 'Dog Licensing', hasContent: true },
      { slug: 'section-500', path: 'section-500', level: 'section' as any, num: 'Section 500', heading: 'Mountain View Special', hasContent: true },
    ],
  });

  await writer.writeSection('fts-test', 'section-100', '<xml/>', '<p>The City of Mountain View establishes these general provisions for governance.</p>');
  await writer.writeSection('fts-test', 'section-200', '<xml/>', '<p>No parking is permitted on Main Street between the hours of 8am and 6pm on weekdays.</p>');
  await writer.writeSection('fts-test', 'section-300', '<xml/>', '<p>Residential zoning permits single-family homes and duplexes. Commercial zoning allows retail.</p>');
  await writer.writeSection('fts-test', 'section-400', '<xml/>', '<p>All dogs must be licensed annually. Dogs must be leashed in public areas at all times.</p>');
  await writer.writeSection('fts-test', 'section-500', '<xml/>', '<p>Mountain View is a great place to live. The Mountain View city council meets monthly.</p>');

  store = new CodeStore(db);
});

afterAll(() => {
  db?.close();
});

describe('FTS5 Search', () => {
  describe('search', () => {
    it('finds sections containing a keyword', () => {
      const results = store.search('fts-test', 'Mountain View');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('path');
      expect(results[0]).toHaveProperty('num');
      expect(results[0]).toHaveProperty('heading');
      expect(results[0]).toHaveProperty('snippet');
    });

    it('returns empty for nonsense keyword', () => {
      const results = store.search('fts-test', 'xyzzy123nonsense');
      expect(results).toEqual([]);
    });

    it('respects limit parameter', () => {
      // 'the' or common words should match many sections
      const results = store.search('fts-test', 'Mountain', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('returns empty for unknown jurisdiction', () => {
      const results = store.search('nonexistent', 'test');
      expect(results).toEqual([]);
    });

    it('provides snippets with context', () => {
      const results = store.search('fts-test', 'parking', 1);
      expect(results.length).toBe(1);
      expect(results[0].snippet.length).toBeGreaterThan('parking'.length);
    });
  });

  describe('hasSearchIndex', () => {
    it('returns true for indexed jurisdiction', () => {
      expect(store.hasSearchIndex('fts-test')).toBe(true);
    });

    it('returns false for unindexed jurisdiction', () => {
      expect(store.hasSearchIndex('nonexistent')).toBe(false);
    });
  });

  describe('getCodeText from DB', () => {
    it('returns text without HTML tags', () => {
      const text = store.getCodeText('fts-test', 'section-100');
      expect(text).toBeDefined();
      expect(text).toContain('Mountain View');
      expect(text).not.toContain('<p>');
    });
  });
});
