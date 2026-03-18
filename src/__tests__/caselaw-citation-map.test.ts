import { describe, it, expect } from 'vitest';
import { buildCitationQueries, extractSectionNumber } from '../caselaw/citation-map.js';
import type { Jurisdiction, TocNode } from '../types.js';

function makeJurisdiction(overrides: Partial<Jurisdiction> & { id: string; publisher: Jurisdiction['publisher'] }): Jurisdiction {
  return {
    name: 'Test',
    type: 'state',
    state: 'CA',
    parentId: null,
    fips: null,
    lastCrawled: '',
    lastUpdated: '',
    ...overrides,
  } as Jurisdiction;
}

describe('extractSectionNumber', () => {
  it('extracts from section-{num} path', () => {
    expect(extractSectionNumber('title-42/chapter-21/section-1983')).toBe('1983');
  });

  it('extracts dotted section numbers', () => {
    expect(extractSectionNumber('part-100/section-100.50')).toBe('100.50');
  });

  it('extracts from tocNode.num', () => {
    expect(extractSectionNumber('chapter-1', { num: 'Section 12965' } as TocNode)).toBe('12965');
  });

  it('extracts from § format', () => {
    expect(extractSectionNumber('chapter-1', { num: '§ 349' } as TocNode)).toBe('349');
  });

  it('returns null when no section found', () => {
    expect(extractSectionNumber('chapter-1')).toBeNull();
  });
});

describe('buildCitationQueries', () => {
  describe('USC', () => {
    it('generates USC citation queries', () => {
      const j = makeJurisdiction({
        id: 'us-usc-title-42',
        publisher: { name: 'usc', sourceId: '42', url: '' },
      });
      const queries = buildCitationQueries(j, 'chapter-21/section-1983');
      expect(queries.length).toBe(3);
      expect(queries[0].label).toBe('42 U.S.C. § 1983');
      expect(queries[0].query).toBe('"42 U.S.C. § 1983"');
      expect(queries[1].label).toBe('42 USC § 1983');
    });
  });

  describe('CFR', () => {
    it('generates CFR citation queries', () => {
      const j = makeJurisdiction({
        id: 'us-cfr-title-24',
        publisher: { name: 'ecfr', sourceId: '24', url: '' },
      });
      const queries = buildCitationQueries(j, 'part-100/section-100.50');
      expect(queries.length).toBe(2);
      expect(queries[0].label).toBe('24 C.F.R. § 100.50');
    });
  });

  describe('California', () => {
    it('generates California Government Code queries', () => {
      const j = makeJurisdiction({
        id: 'ca-gov',
        publisher: { name: 'ca-leginfo', sourceId: 'GOV', url: '' },
      });
      const queries = buildCitationQueries(j, 'title-2/division-3/section-12965');
      expect(queries.length).toBe(3);
      expect(queries[0].label).toBe('Cal. Gov. Code § 12965');
      expect(queries[2].label).toBe('Government Code section 12965');
    });

    it('generates California Penal Code queries', () => {
      const j = makeJurisdiction({
        id: 'ca-pen',
        publisher: { name: 'ca-leginfo', sourceId: 'PEN', url: '' },
      });
      const queries = buildCitationQueries(j, 'part-1/title-8/section-187');
      expect(queries.length).toBe(3);
      expect(queries[0].label).toBe('Cal. Pen. Code § 187');
      expect(queries[2].label).toBe('Penal Code section 187');
    });
  });

  describe('New York', () => {
    it('generates NY General Business Law queries', () => {
      const j = makeJurisdiction({
        id: 'ny-general-business',
        state: 'NY',
        publisher: { name: 'ny-openleg', sourceId: 'GBS', url: '' },
      });
      const queries = buildCitationQueries(j, 'article-22-a/section-349');
      expect(queries.length).toBe(1);
      expect(queries[0].label).toBe('N.Y. Gen. Bus. Law § 349');
    });
  });

  describe('State statutes', () => {
    it('generates Florida Statute queries', () => {
      const j = makeJurisdiction({
        id: 'fl-statutes',
        state: 'FL',
        publisher: { name: 'fl-statutes', sourceId: 'fl', url: '' },
      });
      const queries = buildCitationQueries(j, 'title-xl/chapter-718/section-718.111');
      expect(queries.length).toBe(1);
      expect(queries[0].label).toBe('Fla. Stat. § 718.111');
    });

    it('generates Texas Property Code queries', () => {
      const j = makeJurisdiction({
        id: 'tx-property-code',
        state: 'TX',
        publisher: { name: 'tx-statutes', sourceId: 'property', url: '' },
      });
      const queries = buildCitationQueries(j, 'title-8/chapter-92/section-92.331');
      expect(queries.length).toBe(1);
      expect(queries[0].label).toBe('Tex. Prop. Code § 92.331');
    });
  });

  describe('Municipal codes', () => {
    it('returns empty for Municode jurisdictions', () => {
      const j = makeJurisdiction({
        id: 'ca-mountain-view',
        publisher: { name: 'municode', sourceId: '17072', url: '' },
      });
      const queries = buildCitationQueries(j, 'part-i/article-i/section-100');
      expect(queries).toEqual([]);
    });

    it('returns empty for American Legal jurisdictions', () => {
      const j = makeJurisdiction({
        id: 'ca-san-francisco',
        publisher: { name: 'amlegal', sourceId: 'sf', url: '' },
      });
      const queries = buildCitationQueries(j, 'article-1/section-1.1');
      expect(queries).toEqual([]);
    });
  });
});
