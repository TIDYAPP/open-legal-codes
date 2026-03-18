import { Hono } from 'hono';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { resolveJurisdiction, crawlingResponse, crawlFailedResponse, notFoundResponse } from './resolve.js';
import { getCaseLaw } from '../caselaw/index.js';

export const caselawRoutes = new Hono();

/**
 * GET /jurisdictions/:id/caselaw/*path
 * Find court opinions that cite a specific code section.
 * Query params: ?limit=20 (default), ?offset=0 (for pagination)
 */
caselawRoutes.get('/:id/caselaw/*', async (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/caselaw/')[1] || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (!path) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Path is required' } }, 400);
  }

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
  if (resolved.status === 'crawl_failed') return crawlFailedResponse(c, resolved);

  const { jurisdiction } = resolved;
  const tocNode = store.getTocNode(id, path);

  try {
    const result = await getCaseLaw(jurisdiction, path, tocNode || undefined, { limit, offset });

    // Case law is stable — cache for a day at the edge
    c.header('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');

    return c.json({
      data: {
        jurisdiction: id,
        jurisdictionName: jurisdiction.name,
        path,
        num: tocNode?.num ?? null,
        heading: tocNode?.heading ?? null,
        citationQueries: result.queries.map(q => q.label),
        cases: result.results,
        totalCount: result.totalCount,
        offset,
        limit,
        supported: result.supported,
        fromCache: result.fromCache,
        note: result.supported
          ? 'Case law sourced from CourtListener (Free Law Project). We link to opinions — we do not host them.'
          : 'Case law lookup is not yet available for municipal codes due to non-standardized citation formats.',
      },
      meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
    });
  } catch (err: any) {
    if (err.message?.includes('COURTLISTENER_API_TOKEN')) {
      return c.json({
        error: { code: 'CONFIGURATION_ERROR', message: err.message },
      }, 503);
    }
    throw err;
  }
});
