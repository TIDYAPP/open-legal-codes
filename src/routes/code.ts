import { Hono } from 'hono';
import type { Context } from 'hono';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { permalinkUrl } from '../permalink.js';
import { resolveJurisdiction, crawlingResponse, crawlFailedResponse, notFoundResponse, notFoundOrCrawling } from './resolve.js';

export const codeRoutes = new Hono();

function handleCodeRequest(c: Context, id: string, path: string, codeId?: string) {
  const format = c.req.query('format') || 'text';

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
  if (resolved.status === 'crawl_failed') return crawlFailedResponse(c, resolved);

  const { jurisdiction } = resolved;

  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');

  if (format === 'xml') {
    const xml = store.getCodeXml(id, path, codeId);
    if (!xml) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);
    c.header('Content-Type', 'application/xml');
    return c.body(xml);
  }

  if (format === 'html') {
    const html = store.getCodeHtml(id, path, codeId);
    if (!html) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);
    c.header('Content-Type', 'text/html');
    return c.body(html);
  }

  const text = store.getCodeText(id, path, codeId);
  if (!text) return notFoundOrCrawling(c, id, `Path '${path}' not found in '${id}'`);

  const tocInfo = store.getTocNode(id, path, codeId);

  return c.json({
    data: {
      jurisdiction: id,
      jurisdictionName: jurisdiction.name,
      codeId: codeId || store.resolveCodeId(id),
      path,
      num: tocInfo?.num ?? null,
      heading: tocInfo?.heading ?? null,
      level: tocInfo?.level ?? null,
      text,
      url: permalinkUrl(jurisdiction, path, codeId),
      lastCrawled: jurisdiction.lastCrawled || null,
    },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
}

/** GET /jurisdictions/:id/code/*path — uses default code */
codeRoutes.get('/:id/code/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/code/')[1] || '';
  return handleCodeRequest(c, id, path);
});

/** GET /jurisdictions/:id/codes/:codeId/code/*path — specific code */
codeRoutes.get('/:id/codes/:codeId/code/*', (c) => {
  const id = c.req.param('id');
  const codeId = c.req.param('codeId');
  // Extract path after /codes/:codeId/code/
  const fullPath = c.req.path;
  const codeSegment = `/codes/${codeId}/code/`;
  const idx = fullPath.indexOf(codeSegment);
  const path = idx >= 0 ? fullPath.slice(idx + codeSegment.length) : '';
  return handleCodeRequest(c, id, path, codeId);
});
