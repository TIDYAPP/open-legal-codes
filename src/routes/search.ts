import { Hono } from 'hono';
import type { JurisdictionType } from '../types.js';
import { store } from '../store/index.js';
import { crawlTracker } from '../crawl-tracker.js';
import { registryStore } from '../registry/store.js';
import { triggerAutoCrawl } from '../auto-crawl.js';
import { BRANDING } from '../branding.js';
import { permalinkUrl } from '../permalink.js';

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

  const jurisdiction = store.getJurisdiction(id);
  if (!jurisdiction) {
    // Check registry and trigger auto-crawl if known
    const entry = registryStore.getById(id);
    if (entry) {
      triggerAutoCrawl(entry);
      const status = crawlTracker.getStatus(id);
      return c.json(
        {
          status: 'CRAWL_IN_PROGRESS',
          message: `Data for '${id}' is being fetched.`,
          progress: status ? { phase: status.progress.phase, total: status.progress.total, completed: status.progress.completed } : { phase: 'toc', total: 0, completed: 0 },
          startedAt: status?.startedAt || new Date().toISOString(),
          retryAfter: 30,
        },
        202
      );
    }
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  if (!store.hasSearchIndex(id)) {
    const status = crawlTracker.getStatus(id);
    if (status) {
      return c.json(
        {
          status: 'CRAWL_IN_PROGRESS',
          message: `Data for '${id}' is being fetched. This can take up to 10 minutes.`,
          progress: { phase: status.progress.phase, total: status.progress.total, completed: status.progress.completed },
          startedAt: status.startedAt,
          retryAfter: 30,
        },
        202
      );
    }
    return c.json(
      { error: { code: 'NOT_FOUND', message: `No code data available for '${id}'` } },
      404
    );
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
