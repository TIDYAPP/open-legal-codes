import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodeStore } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { createDb } from '../store/db.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let store: CodeStore;
let writer: CodeWriter;

const testJurisdiction = {
  id: 'test-feedback-city',
  name: 'Feedback City, TS',
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

describe('feedback store', () => {
  it('creates feedback and returns an id', () => {
    const id = writer.createFeedback({
      jurisdictionId: 'test-feedback-city',
      path: 'title-1/chapter-1/section-1',
      reportType: 'bad_citation',
      description: 'The citation is wrong',
      ipAddress: '127.0.0.1',
    });

    expect(id).toBeGreaterThan(0);
  });

  it('retrieves feedback by id', () => {
    const id = writer.createFeedback({
      jurisdictionId: 'test-feedback-city',
      path: 'title-1/chapter-2',
      reportType: 'out_of_date',
      description: 'This was updated last year',
    });

    const row = store.getFeedback(id);
    expect(row).toBeDefined();
    expect(row!.jurisdiction_id).toBe('test-feedback-city');
    expect(row!.path).toBe('title-1/chapter-2');
    expect(row!.report_type).toBe('out_of_date');
    expect(row!.status).toBe('pending');
    expect(row!.description).toBe('This was updated last year');
  });

  it('lists feedback with status filter', () => {
    const all = store.listFeedback({ jurisdictionId: 'test-feedback-city' });
    expect(all.length).toBeGreaterThanOrEqual(2);

    const pending = store.listFeedback({ jurisdictionId: 'test-feedback-city', status: 'pending' });
    expect(pending.length).toBe(all.length); // all are pending initially
  });

  it('updates feedback status to resolved', () => {
    const id = writer.createFeedback({
      jurisdictionId: 'test-feedback-city',
      path: 'title-2/section-1',
      reportType: 'wrong_text',
      description: 'Text is garbled',
    });

    writer.updateFeedbackStatus(id, 'resolved', 'Re-crawled and fixed');

    const row = store.getFeedback(id);
    expect(row!.status).toBe('resolved');
    expect(row!.triage_notes).toBe('Re-crawled and fixed');
    expect(row!.resolved_at).toBeTruthy();
  });

  it('updates feedback status to dismissed', () => {
    const id = writer.createFeedback({
      jurisdictionId: 'test-feedback-city',
      path: 'title-3/section-1',
      reportType: 'other',
      description: 'spam',
    });

    writer.updateFeedbackStatus(id, 'dismissed', 'Automated: prompt injection detected');

    const row = store.getFeedback(id);
    expect(row!.status).toBe('dismissed');
    expect(row!.resolved_at).toBeTruthy();
  });

  it('counts recent feedback by IP', () => {
    // Create a few more with a specific IP
    for (let i = 0; i < 3; i++) {
      writer.createFeedback({
        jurisdictionId: 'test-feedback-city',
        path: `rate-limit/section-${i}`,
        reportType: 'other',
        description: '',
        ipAddress: '10.0.0.1',
      });
    }

    const count = store.countRecentFeedback('10.0.0.1', 60);
    expect(count).toBe(3);

    const countOther = store.countRecentFeedback('10.0.0.2', 60);
    expect(countOther).toBe(0);
  });

  it('rejects invalid report_type via SQL CHECK constraint', () => {
    expect(() => {
      writer.createFeedback({
        jurisdictionId: 'test-feedback-city',
        path: 'title-1/section-1',
        reportType: 'invalid_type',
        description: '',
      });
    }).toThrow();
  });

  it('lists feedback ordered by created_at DESC', () => {
    const rows = store.listFeedback({ jurisdictionId: 'test-feedback-city' });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].created_at >= rows[i].created_at).toBe(true);
    }
  });

  it('respects limit and offset', () => {
    const all = store.listFeedback({ jurisdictionId: 'test-feedback-city' });
    const page1 = store.listFeedback({ jurisdictionId: 'test-feedback-city', limit: 2, offset: 0 });
    const page2 = store.listFeedback({ jurisdictionId: 'test-feedback-city', limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).toBe(all[0].id);
    expect(page2[0].id).toBe(all[2].id);
  });
});
