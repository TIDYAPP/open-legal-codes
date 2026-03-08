import { Hono } from 'hono';
import type { JurisdictionType } from '../types.js';
import { store } from '../store/index.js';

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

  const data = store.listJurisdictions({ type, state, publisher });
  return c.json({
    data,
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * GET /jurisdictions/:id
 * Get metadata for a single jurisdiction.
 */
jurisdictionsRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const jurisdiction = store.getJurisdiction(id);

  if (!jurisdiction) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  return c.json({
    data: jurisdiction,
    meta: { timestamp: new Date().toISOString() },
  });
});
