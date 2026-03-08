import { Hono } from 'hono';

export const codeRoutes = new Hono();

/**
 * GET /jurisdictions/:id/code/*path
 * Retrieve the content of a specific node in the code hierarchy.
 * Query params: ?format=xml (default) or ?format=json, ?version=sha
 */
codeRoutes.get('/:id/code/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/code/')[1] || '';
  const format = c.req.query('format') || 'xml';
  const version = c.req.query('version');

  // TODO: Load XML from filesystem, optionally convert to JSON
  if (format === 'xml') {
    // Return USLM XML
    c.header('Content-Type', 'application/xml');
    return c.body('<!-- TODO: serve USLM XML -->');
  }

  // Return JSON
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
    404
  );
});
