import { Hono } from 'hono';

export const tocRoutes = new Hono();

/**
 * GET /jurisdictions/:id/toc
 * Get the full table of contents tree for a jurisdiction's code.
 * Query params: ?depth=1 (limit depth)
 */
tocRoutes.get('/:id/toc', (c) => {
  const id = c.req.param('id');
  const depth = c.req.query('depth') ? parseInt(c.req.query('depth')!, 10) : undefined;

  // TODO: Load from store
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
    404
  );
});

/**
 * GET /jurisdictions/:id/toc/*path
 * Get the TOC subtree rooted at a specific node.
 */
tocRoutes.get('/:id/toc/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/toc/')[1] || '';

  // TODO: Load from store, navigate to path
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
    404
  );
});
