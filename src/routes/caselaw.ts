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
async function handleCaselaw(c: any, id: string, path: string, codeId?: string) {
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
  const tocNode = store.getTocNode(id, path, codeId);

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
          : 'Could not generate a citation query for this path. Case law lookup requires a recognized section number and is currently supported for federal and state statutes.',
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
}

/** GET /jurisdictions/:id/caselaw/*path — default code */
caselawRoutes.get('/:id/caselaw/*', async (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/caselaw/')[1] || '';
  return handleCaselaw(c, id, path);
});

/** GET /jurisdictions/:id/codes/:codeId/caselaw/*path — specific code */
caselawRoutes.get('/:id/codes/:codeId/caselaw/*', async (c) => {
  const id = c.req.param('id');
  const codeId = c.req.param('codeId');
  const fullPath = c.req.path;
  const segment = `/codes/${codeId}/caselaw/`;
  const idx = fullPath.indexOf(segment);
  const path = idx >= 0 ? fullPath.slice(idx + segment.length) : '';
  return handleCaselaw(c, id, path, codeId);
});
