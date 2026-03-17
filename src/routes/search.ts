import { Hono } from 'hono';
import type { JurisdictionType } from '../types.js';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { permalinkUrl } from '../permalink.js';
import { resolveJurisdiction, crawlingResponse, failedResponse, notFoundResponse, notFoundOrCrawling } from './resolve.js';

export const searchRoutes = new Hono();
export const globalSearchRoutes = new Hono();

/**
 * GET /jurisdictions/:id/search?q=rental&limit=20
 * Search for sections containing specific keywords within a jurisdiction's code.
 *
 * Uses in-memory search index — no disk I/O at query time.
 * Handles 100+ concurrent requests without blocking.
 */
searchRoutes.get('/:id/search', (c) => {
  const id = c.req.param('id');
  const query = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  if (!query) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Query parameter "q" is required' } },
      400
    );
  }

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'failed') return failedResponse(c, resolved);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);

  const { jurisdiction } = resolved;

  if (!store.hasSearchIndex(id)) {
    return notFoundOrCrawling(c, id, `No code data available for '${id}'`);
  }

  const results = store.search(id, query, limit).map((r) => ({
    ...r,
    url: permalinkUrl(jurisdiction, r.path),
  }));

  return c.json({
    data: {
      jurisdiction: id,
      jurisdictionName: jurisdiction.name,
      query,
      results,
      total: results.length,
    },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/**
 * GET /search?q=rental&state=TX&type=city&limit=20
 * Search across all cached jurisdictions, optionally filtered by state and type.
 * Only searches jurisdictions that have already been crawled and cached.
 */
globalSearchRoutes.get('/', (c) => {
  const query = c.req.query('q');
  const state = c.req.query('state');
  const type = c.req.query('type') as JurisdictionType | undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  if (!query) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Query parameter "q" is required' } },
      400
    );
  }

  const jurisdictions = store.listJurisdictions({
    state: state || undefined,
    type: type || undefined,
  });

  const allResults: Array<{
    jurisdictionId: string;
    jurisdictionName: string;
    path: string;
    num: string;
    heading: string;
    snippet: string;
    url: string;
  }> = [];

  for (const j of jurisdictions) {
    if (!store.hasSearchIndex(j.id)) continue;

    const results = store.search(j.id, query, limit);
    for (const r of results) {
      allResults.push({
        jurisdictionId: j.id,
        jurisdictionName: j.name,
        ...r,
        url: permalinkUrl(j, r.path),
      });
      if (allResults.length >= limit) break;
    }
    if (allResults.length >= limit) break;
  }

  const totalCached = jurisdictions.length;
  const totalSearchable = jurisdictions.filter(j => store.hasSearchIndex(j.id)).length;

  return c.json({
    data: {
      query,
      results: allResults.slice(0, limit),
      total: allResults.length,
      jurisdictionsSearched: totalSearchable,
      jurisdictionsCached: totalCached,
      note: state
        ? `Searched ${totalSearchable} cached jurisdictions in ${state}. Use /jurisdictions?state=${state} to see all available.`
        : `Searched ${totalSearchable} cached jurisdictions. Filter by state for more relevant results.`,
    },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
