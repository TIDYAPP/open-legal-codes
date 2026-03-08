import { Hono } from 'hono';
import type { JurisdictionType } from '../types.js';

export const jurisdictionsRoutes = new Hono();

/**
 * GET /jurisdictions
 * List all available jurisdictions.
 * Query params: ?type=city&state=CA&publisher=municode
 */
jurisdictionsRoutes.get('/', (c) => {
  const type = c.req.query('type') as JurisdictionType | undefined;
  const state = c.req.query('state');
  const publisher = c.req.query('publisher');

  // TODO: Load from store, apply filters
  return c.json({
    data: [],
    meta: { version: 'stub', timestamp: new Date().toISOString() },
  });
});

/**
 * GET /jurisdictions/:id
 * Get metadata for a single jurisdiction.
 */
jurisdictionsRoutes.get('/:id', (c) => {
  const id = c.req.param('id');

  // TODO: Load from store
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
    404
  );
});
