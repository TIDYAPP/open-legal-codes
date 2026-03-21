import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodeStore } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { createDb } from '../store/db.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let store: CodeStore;
let writer: CodeWriter;

const testJurisdiction = {
  id: 'test-annotations-city',
  name: 'Annotations City, TS',
  type: 'city' as const,
  state: 'TS',
  parentId: null,
  fips: null,
  publisher: { name: 'municode' as const, sourceId: '99', url: 'https://example.com' },
  lastCrawled: '2026-01-01T00:00:00Z',
  lastUpdated: '2026-01-01T00:00:00Z',
};

beforeAll(async () => {
  db = createDb(':memory:');
  store = new CodeStore(db);
  writer = new CodeWriter(db);
  await writer.updateRegistry(testJurisdiction);
});

afterAll(() => {
  db.close();
});

describe('annotations store', () => {
  it('creates annotation and returns an id', () => {
    const id = writer.createAnnotation({
      jurisdictionId: 'test-annotations-city',
      path: 'title-1/section-1',
      url: 'https://lw.com/analysis/zoning-law',
      title: 'Zoning Law Analysis',
      sourceName: 'Latham & Watkins',
      sourceDomain: 'lw.com',
      annotationType: 'legal_analysis',
      description: 'Comprehensive analysis of local zoning provisions',
      ipAddress: '127.0.0.1',
      status: 'approved',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('retrieves annotation by id', () => {
    const id = writer.createAnnotation({
      jurisdictionId: 'test-annotations-city',
      path: 'title-1/section-2',
      url: 'https://justice.gov/guidance/municipal-code',
      title: 'DOJ Guidance on Municipal Codes',
      sourceDomain: 'justice.gov',
      annotationType: 'government_guidance',
      status: 'approved',
    });

    const row = store.getAnnotation(id);
    expect(row).toBeDefined();
    expect(row!.jurisdiction_id).toBe('test-annotations-city');
    expect(row!.url).toBe('https://justice.gov/guidance/municipal-code');
    expect(row!.title).toBe('DOJ Guidance on Municipal Codes');
    expect(row!.annotation_type).toBe('government_guidance');
    expect(row!.status).toBe('approved');
  });

  it('lists only approved annotations by default', () => {
    // Create a pending annotation
    writer.createAnnotation({
      jurisdictionId: 'test-annotations-city',
      path: 'title-1/section-1',
      url: 'https://random-blog.xyz/my-analysis',
      title: 'Some Blog Post',
      sourceDomain: 'random-blog.xyz',
      annotationType: 'other',
      status: 'pending',
    });

    const approved = store.listAnnotations({
      jurisdictionId: 'test-annotations-city',
      path: 'title-1/section-1',
    });
    // Should only include the approved one, not the pending one
    expect(approved.every(a => a.status === 'approved')).toBe(true);
    expect(approved.length).toBe(1);
  });

  it('lists pending annotations with explicit status filter', () => {
    const pending = store.listAnnotations({
      jurisdictionId: 'test-annotations-city',
      status: 'pending',
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every(a => a.status === 'pending')).toBe(true);
  });

  it('filters by annotation type', () => {
    const govt = store.listAnnotations({
      jurisdictionId: 'test-annotations-city',
      type: 'government_guidance',
    });
    expect(govt.length).toBe(1);
    expect(govt[0].annotation_type).toBe('government_guidance');
  });

  it('updates annotation status', () => {
    const pending = store.listAnnotations({
      jurisdictionId: 'test-annotations-city',
      status: 'pending',
    });
    const id = pending[0].id;

    writer.updateAnnotationStatus(id, 'rejected', 'Spam URL');

    const row = store.getAnnotation(id);
    expect(row!.status).toBe('rejected');
    expect(row!.triage_notes).toBe('Spam URL');
    expect(row!.reviewed_at).toBeTruthy();
  });

  it('prevents duplicate URL for same section', () => {
    expect(() => {
      writer.createAnnotation({
        jurisdictionId: 'test-annotations-city',
        path: 'title-1/section-1',
        url: 'https://lw.com/analysis/zoning-law',
        title: 'Duplicate',
        sourceDomain: 'lw.com',
        annotationType: 'legal_analysis',
        status: 'approved',
      });
    }).toThrow();
  });

  it('allows same URL for different sections', () => {
    const id = writer.createAnnotation({
      jurisdictionId: 'test-annotations-city',
      path: 'title-2/section-1',
      url: 'https://lw.com/analysis/zoning-law',
      title: 'Same URL Different Section',
      sourceDomain: 'lw.com',
      annotationType: 'legal_analysis',
      status: 'approved',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('rejects invalid annotation_type via SQL CHECK constraint', () => {
    expect(() => {
      writer.createAnnotation({
        jurisdictionId: 'test-annotations-city',
        path: 'title-1/section-1',
        url: 'https://example.com/bad-type',
        title: 'Bad Type',
        sourceDomain: 'example.com',
        annotationType: 'invalid_type',
        status: 'approved',
      });
    }).toThrow();
  });

  it('counts recent annotations by IP for rate limiting', () => {
    for (let i = 0; i < 3; i++) {
      writer.createAnnotation({
        jurisdictionId: 'test-annotations-city',
        path: `rate-limit/section-${i}`,
        url: `https://example.com/rate-limit-${i}`,
        title: `Rate limit test ${i}`,
        sourceDomain: 'example.com',
        annotationType: 'other',
        ipAddress: '10.0.0.99',
        status: 'pending',
      });
    }

    const count = store.countRecentAnnotations('10.0.0.99', 60);
    expect(count).toBe(3);

    const countOther = store.countRecentAnnotations('10.0.0.100', 60);
    expect(countOther).toBe(0);
  });

  it('respects limit and offset', () => {
    const all = store.listAnnotations({ jurisdictionId: 'test-annotations-city', status: 'approved' });
    const page1 = store.listAnnotations({ jurisdictionId: 'test-annotations-city', status: 'approved', limit: 1, offset: 0 });
    const page2 = store.listAnnotations({ jurisdictionId: 'test-annotations-city', status: 'approved', limit: 1, offset: 1 });

    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0].id).toBe(all[0].id);
    expect(page2[0].id).toBe(all[1].id);
  });
});

describe('caselaw annotations', () => {
  // Seed a court decision for FK reference
  beforeAll(() => {
    db.prepare(`
      INSERT OR IGNORE INTO court_decisions (cluster_id, case_name, court, date_filed, url, citation, cite_count, fetched_at)
      VALUES (12345, 'Smith v. City', 'US Court of Appeals', '2025-01-15', 'https://courtlistener.com/opinion/12345', '123 F.3d 456', 5, '2026-01-01')
    `).run();
  });

  it('creates a caselaw annotation with cluster_id', () => {
    const id = writer.createAnnotation({
      targetType: 'caselaw',
      jurisdictionId: 'test-annotations-city',
      clusterId: 12345,
      url: 'https://lw.com/analysis/smith-v-city',
      title: 'Analysis of Smith v. City',
      sourceName: 'Latham & Watkins',
      sourceDomain: 'lw.com',
      annotationType: 'legal_analysis',
      status: 'approved',
    });
    expect(id).toBeGreaterThan(0);

    const row = store.getAnnotation(id);
    expect(row!.target_type).toBe('caselaw');
    expect(row!.cluster_id).toBe(12345);
    expect(row!.path).toBe('');
  });

  it('lists caselaw annotations by cluster_id', () => {
    const rows = store.listAnnotations({
      targetType: 'caselaw',
      clusterId: 12345,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].cluster_id).toBe(12345);
    expect(rows[0].target_type).toBe('caselaw');
  });

  it('does not mix section and caselaw annotations', () => {
    const sectionRows = store.listAnnotations({
      targetType: 'section',
      jurisdictionId: 'test-annotations-city',
    });
    expect(sectionRows.every(a => a.target_type === 'section')).toBe(true);

    const caselawRows = store.listAnnotations({
      targetType: 'caselaw',
    });
    expect(caselawRows.every(a => a.target_type === 'caselaw')).toBe(true);
  });

  it('prevents duplicate URL for same cluster', () => {
    expect(() => {
      writer.createAnnotation({
        targetType: 'caselaw',
        jurisdictionId: 'test-annotations-city',
        clusterId: 12345,
        url: 'https://lw.com/analysis/smith-v-city',
        title: 'Duplicate Caselaw',
        sourceDomain: 'lw.com',
        annotationType: 'legal_analysis',
        status: 'approved',
      });
    }).toThrow();
  });

  it('allows same URL on different clusters', () => {
    db.prepare(`
      INSERT OR IGNORE INTO court_decisions (cluster_id, case_name, court, date_filed, url, citation, cite_count, fetched_at)
      VALUES (67890, 'Jones v. County', 'State Supreme Court', '2025-06-01', 'https://courtlistener.com/opinion/67890', '789 P.2d 123', 2, '2026-01-01')
    `).run();

    const id = writer.createAnnotation({
      targetType: 'caselaw',
      jurisdictionId: 'test-annotations-city',
      clusterId: 67890,
      url: 'https://lw.com/analysis/smith-v-city',
      title: 'Same URL Different Cluster',
      sourceDomain: 'lw.com',
      annotationType: 'legal_analysis',
      status: 'approved',
    });
    expect(id).toBeGreaterThan(0);
  });
});

describe('trusted domains', () => {
  it('lists seeded trusted domains', () => {
    const domains = store.listTrustedDomains();
    expect(domains.length).toBeGreaterThan(40);
    const lwDomain = domains.find(d => d.domain === 'lw.com');
    expect(lwDomain).toBeDefined();
    expect(lwDomain!.source_name).toBe('Latham & Watkins');
    expect(lwDomain!.source_type).toBe('law_firm');
  });

  it('recognizes exact match trusted domain', () => {
    const result = store.isTrustedDomain('lw.com');
    expect(result.trusted).toBe(true);
    expect(result.sourceName).toBe('Latham & Watkins');
  });

  it('recognizes subdomain of trusted domain', () => {
    const result = store.isTrustedDomain('blog.lw.com');
    expect(result.trusted).toBe(true);
    expect(result.sourceName).toBe('Latham & Watkins');
  });

  it('strips www. prefix', () => {
    const result = store.isTrustedDomain('www.kirkland.com');
    expect(result.trusted).toBe(true);
    expect(result.sourceName).toBe('Kirkland & Ellis');
  });

  it('auto-trusts any .gov domain', () => {
    const result = store.isTrustedDomain('www.someagency.gov');
    expect(result.trusted).toBe(true);
    expect(result.sourceType).toBe('government');
  });

  it('returns known name for seeded .gov domain', () => {
    const result = store.isTrustedDomain('justice.gov');
    expect(result.trusted).toBe(true);
    expect(result.sourceName).toBe('U.S. Department of Justice');
  });

  it('rejects unknown domains', () => {
    const result = store.isTrustedDomain('random-blog.xyz');
    expect(result.trusted).toBe(false);
    expect(result.sourceName).toBeUndefined();
  });
});
