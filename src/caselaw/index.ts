/**
 * Case law service — orchestrates citation mapping, caching, and CourtListener queries.
 */

import type Database from 'better-sqlite3';
import type { Jurisdiction, TocNode } from '../types.js';
import type { CaseLawResult, CaseLawPage } from './types.js';
import { buildCitationQueries } from './citation-map.js';
import { searchCaseLaw } from './courtlistener.js';
import { getDb } from '../store/db.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CACHED_RESULTS = 100;

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

  // Check cache
  const cached = getCachedCaseLawMeta(db, jurisdiction.id, codePath);
  if (cached && !isStale(cached.fetchedAt)) {
    // Serve from cache using SQL LIMIT/OFFSET
    const results = getCachedResults(db, jurisdiction.id, codePath, limit, offset);
    if (results.length > 0 || offset === 0) {
      return {
        results,
        totalCount: cached.totalCount,
        queries,
        supported: true,
        fromCache: true,
      };
    }
  }

  // Query CourtListener
  const queryStrings = queries.map(q => q.query);
  const { results, totalCount } = await searchCaseLaw(queryStrings, { limit, offset });

  // If this is page 1, cache the results
  if (offset === 0) {
    writeCaseLawCache(db, jurisdiction.id, codePath, {
      queries: queryStrings,
      fetchedAt: new Date().toISOString(),
      totalCount,
      results: results.slice(0, MAX_CACHED_RESULTS),
    });
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

interface CachedMeta {
  fetchedAt: string;
  totalCount: number;
}

function isStale(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > CACHE_TTL_MS;
}

function getCachedCaseLawMeta(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
): CachedMeta | null {
  const row = db.prepare(
    'SELECT fetched_at, total_count FROM caselaw_cache WHERE jurisdiction_id = ? AND section_path = ?'
  ).get(jurisdictionId, sectionPath) as { fetched_at: string; total_count: number } | undefined;

  return row ? { fetchedAt: row.fetched_at, totalCount: row.total_count } : null;
}

function getCachedResults(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
  limit: number,
  offset: number,
): CaseLawResult[] {
  const rows = db.prepare(
    `SELECT cluster_id, case_name, court, date_filed, url, snippet, citation, cite_count
     FROM caselaw_results
     WHERE jurisdiction_id = ? AND section_path = ?
     ORDER BY date_filed DESC
     LIMIT ? OFFSET ?`
  ).all(jurisdictionId, sectionPath, limit, offset) as any[];

  return rows.map(rowToCaseLawResult);
}

function writeCaseLawCache(
  db: Database.Database,
  jurisdictionId: string,
  sectionPath: string,
  data: { queries: string[]; fetchedAt: string; totalCount: number; results: CaseLawResult[] },
): void {
  const run = db.transaction(() => {
    // Clear old cache for this section
    db.prepare('DELETE FROM caselaw_results WHERE jurisdiction_id = ? AND section_path = ?')
      .run(jurisdictionId, sectionPath);
    db.prepare('DELETE FROM caselaw_cache WHERE jurisdiction_id = ? AND section_path = ?')
      .run(jurisdictionId, sectionPath);

    // Insert cache metadata
    db.prepare(`
      INSERT INTO caselaw_cache (jurisdiction_id, section_path, queries, fetched_at, total_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(jurisdictionId, sectionPath, JSON.stringify(data.queries), data.fetchedAt, data.totalCount);

    // Insert results
    const insert = db.prepare(`
      INSERT INTO caselaw_results
        (jurisdiction_id, section_path, cluster_id, case_name, court, date_filed, url, snippet, citation, cite_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of data.results) {
      insert.run(
        jurisdictionId, sectionPath, r.clusterId,
        r.caseName, r.court, r.dateFiled, r.url,
        r.snippet, r.citation, r.citeCount,
      );
    }
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
