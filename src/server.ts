import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { jurisdictionsRoutes } from './routes/jurisdictions.js';
import { tocRoutes } from './routes/toc.js';
import { codeRoutes } from './routes/code.js';
import { searchRoutes } from './routes/search.js';
import { lookupRoutes } from './routes/lookup.js';

import { store } from './store/index.js';

store.initialize();

const app = new Hono();

// Health check
app.get('/', (c) =>
  c.json({
    name: 'Open Legal Codes',
    version: '0.1.0',
    description: 'Retrieve US legal codes programmatically',
    endpoints: {
      jurisdictions: '/api/v1/jurisdictions',
      lookup: '/api/v1/lookup?city=Mountain+View&state=CA',
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

app.route('/api/v1', api);

// 404 fallback
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
);

const port = parseInt(process.env.PORT || '3100', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Open Legal Codes running on http://localhost:${port}`);
});

export default app;
