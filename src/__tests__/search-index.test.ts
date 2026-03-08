import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { CodeStore } from '../store/index.js';

const CODES_DIR = join(process.cwd(), 'codes');

describe('SearchIndex (via CodeStore)', () => {
  const store = new CodeStore(CODES_DIR);

  beforeAll(() => {
    store.initialize();
  });

  describe('search', () => {
    it('finds sections containing a keyword', () => {
      const results = store.search('ca-mountain-view', 'Mountain View');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('path');
      expect(results[0]).toHaveProperty('num');
      expect(results[0]).toHaveProperty('heading');
      expect(results[0]).toHaveProperty('snippet');
      expect(results[0].snippet.toLowerCase()).toContain('mountain view');
    });

    it('returns empty for nonsense keyword', () => {
      const results = store.search('ca-mountain-view', 'xyzzy123nonsense');
      expect(results).toEqual([]);
    });

    it('respects limit parameter', () => {
      // 'the' should match many sections
      const results = store.search('ca-mountain-view', 'the', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('is case-insensitive', () => {
      const upper = store.search('ca-mountain-view', 'MOUNTAIN VIEW', 5);
      const lower = store.search('ca-mountain-view', 'mountain view', 5);
      expect(upper.length).toBe(lower.length);
      expect(upper.map(r => r.path)).toEqual(lower.map(r => r.path));
    });

    it('returns empty for unknown jurisdiction', () => {
      const results = store.search('nonexistent', 'test');
      expect(results).toEqual([]);
    });

    it('provides snippets with context', () => {
      const results = store.search('ca-mountain-view', 'Mountain View', 1);
      expect(results.length).toBe(1);
      // Snippet should be longer than just the search term
      expect(results[0].snippet.length).toBeGreaterThan('Mountain View'.length);
    });
  });

  describe('hasSearchIndex', () => {
    it('returns true for indexed jurisdiction', () => {
      expect(store.hasSearchIndex('ca-mountain-view')).toBe(true);
    });

    it('returns false for unindexed jurisdiction', () => {
      expect(store.hasSearchIndex('nonexistent')).toBe(false);
    });
  });

  describe('getCodeText from index', () => {
    it('returns text from index without disk I/O', () => {
      const text = store.getCodeText('ca-mountain-view', 'part-i/article-i/section-100');
      expect(text).toBeDefined();
      expect(text).toContain('Mountain View');
    });
  });

  describe('concurrent search performance', () => {
    it('handles 100 concurrent searches without error', async () => {
      const queries = [
        'parking', 'zoning', 'dog', 'rental', 'permit',
        'tax', 'water', 'fire', 'building', 'noise',
      ];

      // Fire 100 concurrent searches (10 queries x 10 times each)
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        const query = queries[i % queries.length];
        promises.push(
          new Promise<void>((resolve) => {
            const results = store.search('ca-mountain-view', query, 5);
            // Just verify it doesn't throw and returns an array
            expect(Array.isArray(results)).toBe(true);
            resolve();
          })
        );
      }

      await Promise.all(promises);
    });
  });
});
