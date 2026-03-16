import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { serve } from '@hono/node-server';
import { tocRoutes } from './routes/toc.js';
import { codeRoutes } from './routes/code.js';
import { searchRoutes } from './routes/search.js';
import { lookupRoutes } from './routes/lookup.js';
import { registryRoutes } from './routes/registry.js';
import { jurisdictionsRoutes } from './routes/jurisdictions.js';
import { createMcpRoutes } from './mcp-http.js';

import { store } from './store/index.js';
import { registryStore } from './registry/store.js';
import { BRANDING } from './branding.js';

store.initialize();
registryStore.initialize();

const app = new Hono();

// Gzip compression for all responses
app.use('*', compress());

// CORS for cross-origin API access
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['https://openlegalcodes.org', 'http://localhost:3000'];
app.use('/api/*', cors({ origin: allowedOrigins }));

// Health check with uptime and cache stats
const startTime = Date.now();
app.get('/', (c) =>
  c.json({
    name: 'Open Legal Codes',
    version: '0.1.0',
    status: 'ok',
    poweredBy: BRANDING.poweredBy,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    cache: {
      jurisdictions: store.listJurisdictions().length,
    },
    endpoints: {
      lookup: '/api/v1/lookup?slug=mountain-view&state=CA',
      toc: '/api/v1/jurisdictions/:id/toc',
      code: '/api/v1/jurisdictions/:id/code/*path',
      search: '/api/v1/jurisdictions/:id/search?q=keyword',
    },
  })
);

// Mount API routes
const api = new Hono();
api.route('/jurisdictions', jurisdictionsRoutes);
api.route('/jurisdictions', tocRoutes);
api.route('/jurisdictions', codeRoutes);
api.route('/jurisdictions', searchRoutes);
api.route('/lookup', lookupRoutes);
api.route('/registry', registryRoutes);

app.route('/api/v1', api);

// MCP Streamable HTTP endpoint (zero-install MCP access)
app.route('/mcp', createMcpRoutes(store));

// 404 fallback
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
);

const port = parseInt(process.env.PORT || '3100', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Open Legal Codes running on http://localhost:${port}`);
});

export default app;
