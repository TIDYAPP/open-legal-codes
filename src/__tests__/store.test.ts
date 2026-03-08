import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { CodeStore } from '../store/index.js';

const CODES_DIR = join(process.cwd(), 'codes');

describe('CodeStore', () => {
  const store = new CodeStore(CODES_DIR);
  store.initialize();

  describe('listJurisdictions', () => {
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

    it('returns empty for nonexistent state', () => {
      expect(store.listJurisdictions({ state: 'ZZ' })).toEqual([]);
    });
  });

  describe('getJurisdiction', () => {
    it('returns jurisdiction by ID', () => {
      const j = store.getJurisdiction('ca-mountain-view');
      expect(j).toBeDefined();
      expect(j!.name).toBe('Mountain View, CA');
    });

    it('returns undefined for unknown ID', () => {
      expect(store.getJurisdiction('nonexistent')).toBeUndefined();
    });
  });

  describe('getToc', () => {
    it('returns TOC tree for crawled jurisdiction', () => {
      const toc = store.getToc('ca-mountain-view');
      expect(toc).toBeDefined();
      expect(toc!.jurisdiction).toBe('ca-mountain-view');
      expect(toc!.children.length).toBeGreaterThan(0);
    });

    it('returns undefined for jurisdiction without TOC', () => {
      expect(store.getToc('nonexistent')).toBeUndefined();
    });
  });

  describe('getCodeText', () => {
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
  });

  describe('getCodeXml', () => {
    it('returns XML content', () => {
      const xml = store.getCodeXml('ca-mountain-view', 'part-i/article-i/section-100');
      expect(xml).toBeDefined();
      expect(xml).toContain('<?xml');
      expect(xml).toContain('lawDoc');
    });
  });

  describe('getCodeHtml', () => {
    it('returns original HTML content', () => {
      const html = store.getCodeHtml('ca-mountain-view', 'part-i/article-i/section-100');
      expect(html).toBeDefined();
      expect(html).toContain('<');
    });
  });
});
