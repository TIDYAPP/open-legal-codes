import { Hono } from 'hono';

export const versionsRoutes = new Hono();

/**
 * GET /jurisdictions/:id/versions
 * List available versions (git commits) for a jurisdiction's code.
 * Query params: ?limit=20&offset=0
 */
versionsRoutes.get('/:id/versions', (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  // TODO: Read git log for jurisdiction directory
  return c.json({
    data: [],
    meta: { version: 'stub', timestamp: new Date().toISOString() },
  });
});
