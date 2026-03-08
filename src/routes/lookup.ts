import { Hono } from 'hono';
import { store } from '../store/index.js';

export const lookupRoutes = new Hono();

/**
 * GET /lookup?city=Mountain+View&state=CA
 * Find a jurisdiction by city/state without knowing the slug.
 */
lookupRoutes.get('/', (c) => {
  const city = c.req.query('city');
  const state = c.req.query('state');
  const county = c.req.query('county');

  if (!city && !state && !county) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'At least one of city, state, or county is required' } },
      400
    );
  }

  let results = store.listJurisdictions({ state: state || undefined });

  if (city) {
    const cityLower = city.toLowerCase();
    results = results.filter((j) => j.name.toLowerCase().includes(cityLower));
  }

  return c.json({
    data: { jurisdictions: results },
    meta: { timestamp: new Date().toISOString() },
  });
});
