import { Hono } from 'hono';
import { registryStore } from '../registry/store.js';

export const registryRoutes = new Hono();

/**
 * GET /registry
 * List all registry entries with optional filters.
 * Query params: ?state=CA&publisher=municode&status=cached&type=city&has_geo=true&bbox=west,south,east,north
 */
registryRoutes.get('/', (c) => {
  const state = c.req.query('state');
  const publisher = c.req.query('publisher');
  const status = c.req.query('status');
  const type = c.req.query('type');
  const hasGeo = c.req.query('has_geo') === 'true';

  let bbox: { west: number; south: number; east: number; north: number } | undefined;
  const bboxParam = c.req.query('bbox');
  if (bboxParam) {
    const parts = bboxParam.split(',').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      bbox = { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
    }
  }

  const data = registryStore.query({
    state, publisher, status, type,
    hasGeo: hasGeo || undefined,
    bbox,
  });

  return c.json({
    data,
    meta: { total: data.length, timestamp: new Date().toISOString() },
  });
});

/**
 * GET /registry/geo
 * Compact format optimized for map rendering.
 * Cached for 1 hour since registry changes infrequently.
 */
registryRoutes.get('/geo', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');

  const data = registryStore.getGeoEntries();
  return c.json({
    data,
    meta: { total: data.length, timestamp: new Date().toISOString() },
  });
});

/**
 * GET /registry/stats
 * Aggregate statistics about the registry.
 */
registryRoutes.get('/stats', (c) => {
  const data = registryStore.getStats();
  return c.json({
    data,
    meta: { timestamp: new Date().toISOString() },
  });
});
