import { Hono } from 'hono';
import { store } from '../store/index.js';

export const codeRoutes = new Hono();

/**
 * GET /jurisdictions/:id/code/*path
 * Retrieve the content of a specific node in the code hierarchy.
 * Query params: ?format=text (default), ?format=xml, ?format=html
 */
codeRoutes.get('/:id/code/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/code/')[1] || '';
  const format = c.req.query('format') || 'text';

  const jurisdiction = store.getJurisdiction(id);
  if (!jurisdiction) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  if (format === 'xml') {
    const xml = store.getCodeXml(id, path);
    if (!xml) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
        404
      );
    }
    c.header('Content-Type', 'application/xml');
    return c.body(xml);
  }

  if (format === 'html') {
    const html = store.getCodeHtml(id, path);
    if (!html) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
        404
      );
    }
    c.header('Content-Type', 'text/html');
    return c.body(html);
  }

  // Default: plain text with rich context for agents
  const text = store.getCodeText(id, path);
  if (!text) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
      404
    );
  }

  // Look up TOC node for heading/num context
  const tocInfo = store.getTocNode(id, path);

  return c.json({
    data: {
      jurisdiction: id,
      jurisdictionName: jurisdiction.name,
      path,
      num: tocInfo?.num ?? null,
      heading: tocInfo?.heading ?? null,
      text,
      url: `https://openlegalcodes.org/${id}/${path}`,
      lastCrawled: jurisdiction.lastCrawled || null,
    },
    meta: { timestamp: new Date().toISOString() },
  });
});
