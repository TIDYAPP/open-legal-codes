import { Hono } from 'hono';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { permalinkUrl } from '../permalink.js';
import { resolveJurisdiction, crawlingResponse, notFoundResponse, notFoundOrCrawling } from './resolve.js';

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

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);

  const { jurisdiction } = resolved;

  // Legal text is stable once cached — cache aggressively at CDN/Vercel edge
  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');

  if (format === 'xml') {
    const xml = store.getCodeXml(id, path);
    if (!xml) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);
    c.header('Content-Type', 'application/xml');
    return c.body(xml);
  }

  if (format === 'html') {
    const html = store.getCodeHtml(id, path);
    if (!html) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);
    c.header('Content-Type', 'text/html');
    return c.body(html);
  }

  // Default: plain text with rich context for agents
  const text = store.getCodeText(id, path);
  if (!text) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);

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
      url: permalinkUrl(jurisdiction, path),
      lastCrawled: jurisdiction.lastCrawled || null,
    },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
