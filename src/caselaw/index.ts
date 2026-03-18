/**
 * Case law service — orchestrates citation mapping, caching, and CourtListener queries.
 *
 * Uses normalized tables:
 * - court_decisions: one row per unique CourtListener opinion cluster
 * - court_decision_statute_references: many-to-many join between decisions and statutes
 * - caselaw_search_log: tracks when we last checked CourtListener for each statute
 */

import type Database from 'better-sqlite3';
import type { Jurisdiction, TocNode } from '../types.js';
import type { CaseLawResult, CaseLawPage } from './types.js';
import { buildCitationQueries } from './citation-map.js';
import { searchCaseLaw } from './courtlistener.js';
import { getDb } from '../store/db.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getCaseLaw(
  jurisdiction: Jurisdiction,
  codePath: string,
  tocNode?: TocNode,
  options?: { offset?: number; limit?: number },
): Promise<CaseLawPage> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const queries = buildCitationQueries(jurisdiction, codePath, tocNode);

  if (queries.length === 0) {
    return {
      results: [],
      totalCount: 0,
      queries: [],
      supported: false,
      fromCache: false,
    };
  }

  const db = getDb();

  // Check if we have a recent search for this statute
  const searchLog = getSearchLog(db, jurisdiction.id, codePath);
  if (searchLog && !isStale(searchLog.lastCheckedAt)) {
    const results = getCachedResults(db, jurisdiction.id, codePath, limit, offset);
    const totalCount = countCachedResults(db, jurisdiction.id, codePath);
    return {
      results,
      totalCount,
      queries,
      supported: true,
      fromCache: true,
    };
  }

  // Query CourtListener
  const queryStrings = queries.map(q => q.query);
  const { results, totalCount } = await searchCaseLaw(queryStrings, { limit, offset });

  // On first page, cache decisions and references
  if (offset === 0) {
    writeResults(db, jurisdiction.id, codePath, queryStrings, results, totalCount);
  }

  return {
    results,
    totalCount,
    queries,
    supported: true,
    fromCache: false,
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface SearchLog {
  lastCheckedAt: string;
  totalCount: number;
}

function isStale(lastCheckedAt: string): boolean {
  const age = Date.now() - new Date(lastCheckedAt).getTime();
  return age > CACHE_TTL_MS;
}

function getSearchLog(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
): SearchLog | null {
  const row = db.prepare(
    'SELECT last_checked_at, total_count FROM caselaw_search_log WHERE jurisdiction_id = ? AND section_path = ?'
  ).get(jurisdictionId, sectionPath) as { last_checked_at: string; total_count: number } | undefined;

  return row ? { lastCheckedAt: row.last_checked_at, totalCount: row.total_count } : null;
}

function getCachedResults(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
  limit: number,
  offset: number,
): CaseLawResult[] {
  const rows = db.prepare(
    `SELECT d.cluster_id, d.case_name, d.court, d.date_filed, d.url,
            r.snippet, d.citation, d.cite_count
     FROM court_decision_statute_references r
     JOIN court_decisions d ON d.cluster_id = r.cluster_id
     WHERE r.jurisdiction_id = ? AND r.section_path = ?
     ORDER BY d.date_filed DESC
     LIMIT ? OFFSET ?`
  ).all(jurisdictionId, sectionPath, limit, offset) as any[];

  return rows.map(rowToCaseLawResult);
}

function countCachedResults(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
): number {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt
     FROM court_decision_statute_references
     WHERE jurisdiction_id = ? AND section_path = ?`
  ).get(jurisdictionId, sectionPath) as { cnt: number };

  return row.cnt;
}

function writeResults(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
  queryStrings: string[],
  results: CaseLawResult[],
  totalCount: number,
): void {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // Upsert each decision (INSERT OR IGNORE — don't overwrite if it already exists)
    const upsertDecision = db.prepare(`
      INSERT INTO court_decisions (cluster_id, case_name, court, date_filed, url, citation, cite_count, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        cite_count = excluded.cite_count,
        fetched_at = excluded.fetched_at
    `);

    // Insert reference (link decision to this statute)
    const insertRef = db.prepare(`
      INSERT OR IGNORE INTO court_decision_statute_references
        (cluster_id, jurisdiction_id, section_path, snippet)
      VALUES (?, ?, ?, ?)
    `);

    for (const r of results) {
      upsertDecision.run(
        r.clusterId, r.caseName, r.court, r.dateFiled,
        r.url, r.citation, r.citeCount, now,
      );
      insertRef.run(r.clusterId, jurisdictionId, sectionPath, r.snippet);
    }

    // Update search log
    db.prepare(`
      INSERT INTO caselaw_search_log (jurisdiction_id, section_path, queries, last_checked_at, total_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jurisdiction_id, section_path) DO UPDATE SET
        queries = excluded.queries,
        last_checked_at = excluded.last_checked_at,
        total_count = excluded.total_count
    `).run(jurisdictionId, sectionPath, JSON.stringify(queryStrings), now, totalCount);
  });

  run();
}

function rowToCaseLawResult(row: any): CaseLawResult {
  return {
    clusterId: row.cluster_id,
    caseName: row.case_name,
    court: row.court,
    dateFiled: row.date_filed,
    url: row.url,
    snippet: row.snippet || '',
    citation: row.citation || '',
    citeCount: row.cite_count || 0,
  };
}
