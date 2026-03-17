import { Hono } from 'hono';
import type { JurisdictionType } from '../types.js';
import { store } from '../store/index.js';
import { registryStore } from '../registry/store.js';
import { crawlTracker } from '../crawl-tracker.js';
import { BRANDING } from '../branding.js';

export const jurisdictionsRoutes = new Hono();

/**
 * GET /jurisdictions
 * List all available jurisdictions from the registry (37k+ catalog).
 * Query params:
 *   ?type=city|county|state|federal  — filter by jurisdiction type
 *   ?state=CA                        — filter by state
 *   ?publisher=municode              — filter by publisher
 *   ?cached=true                     — only return cached/ready jurisdictions
 *   ?limit=100                       — pagination limit (default 100, max 1000)
 *   ?offset=0                        — pagination offset (default 0)
 *   ?q=mountain                      — search by name
 */
jurisdictionsRoutes.get('/', (c) => {
  const type = c.req.query('type') as JurisdictionType | undefined;
  const state = c.req.query('state');
  const publisher = c.req.query('publisher');
  const cached = c.req.query('cached');
  const q = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 1000);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  // If ?cached=true, return only cached jurisdictions (old behavior)
  if (cached === 'true') {
    const data = store.listJurisdictions({ type, state, publisher });
    c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
    return c.json({
      data,
      meta: { total: data.length, limit: data.length, offset: 0, timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
    });
  }

  // Default: return from registry (full catalog)
  let entries;
  if (q) {
    // Name search
    entries = registryStore.findByName(q, state || undefined);
    if (type) entries = entries.filter(e => e.type === type);
    if (publisher) entries = entries.filter(e => e.publisher === publisher);
  } else {
    entries = registryStore.query({ type, state: state || undefined, publisher: publisher || undefined });
  }

  const total = entries.length;
  const page = entries.slice(offset, offset + limit);

  // Enrich with cached status
  const data = page.map(e => ({
    id: e.id,
    name: e.name,
    type: e.type,
    state: e.state,
    fips: e.fips,
    publisher: e.publisher,
    sourceUrl: e.sourceUrl,
    status: store.getToc(e.id) ? 'cached' : (e.status === 'cached' ? 'available' : e.status),
    population: e.population,
  }));

  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
  return c.json({
    data,
    meta: { total, limit, offset, timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/**
 * GET /jurisdictions/:id
 * Get metadata for a single jurisdiction.
 */
jurisdictionsRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const jurisdiction = store.getJurisdiction(id);

  if (jurisdiction) {
    c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
    return c.json({
      data: {
        ...jurisdiction,
        status: 'cached',
      },
      meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
    });
  }

  const registryEntry = registryStore.getById(id);
  if (!registryEntry) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  const crawlStatus = crawlTracker.getStatus(id);
  const status = crawlStatus
    ? 'crawling'
    : (registryEntry.status === 'cached' ? 'available' : registryEntry.status);
  // Don't cache crawling status; cache available/discoverable for 30 min
  c.header('Cache-Control', crawlStatus ? 'no-store' : 'public, s-maxage=604800, stale-while-revalidate=604800');
  return c.json({
    data: {
      id: registryEntry.id,
      name: registryEntry.name,
      type: registryEntry.type,
      state: registryEntry.state,
      parentId: null,
      fips: registryEntry.fips,
      publisher: {
        name: registryEntry.publisher,
        sourceId: registryEntry.sourceId,
        url: registryEntry.sourceUrl,
      },
      lastCrawled: '',
      lastUpdated: '',
      sourceUrl: registryEntry.sourceUrl,
      population: registryEntry.population,
      lastScanned: registryEntry.lastScanned,
      status,
    },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
