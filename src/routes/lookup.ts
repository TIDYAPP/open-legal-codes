import { Hono } from 'hono';

export const lookupRoutes = new Hono();

/**
 * GET /lookup?city=Palm+Desert&state=CA&county=Riverside
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

  // TODO: Match against jurisdictions registry
  return c.json({
    data: { jurisdictions: [] },
    meta: { version: 'stub', timestamp: new Date().toISOString() },
  });
});
