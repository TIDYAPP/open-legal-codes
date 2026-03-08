import { Hono } from 'hono';
import { store } from '../store/index.js';

export const searchRoutes = new Hono();

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
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  if (!store.hasSearchIndex(id)) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `No code data available for '${id}'` } },
      404
    );
  }

  const results = store.search(id, query, limit);

  return c.json({
    data: {
      jurisdiction: id,
      jurisdictionName: jurisdiction.name,
      query,
      results,
      total: results.length,
    },
    meta: { timestamp: new Date().toISOString() },
  });
});
