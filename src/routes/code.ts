import { Hono } from 'hono';
import type { Context } from 'hono';
import { store } from '../store/index.js';
import { crawlTracker } from '../crawl-tracker.js';
import { registryStore } from '../registry/store.js';
import { triggerAutoCrawl } from '../auto-crawl.js';
import { BRANDING } from '../branding.js';
import { permalinkUrl } from '../permalink.js';

export const codeRoutes = new Hono();

/** Return 202 if a crawl is active for this jurisdiction, otherwise 404 */
function notFoundOrInProgress(c: Context, id: string, path: string) {
  const status = crawlTracker.getStatus(id);
  if (status) {
    return c.json(
      {
        status: 'CRAWL_IN_PROGRESS',
        message: `Data for '${id}' is being fetched. This can take up to 10 minutes.`,
        progress: { phase: status.progress.phase, total: status.progress.total, completed: status.progress.completed },
        startedAt: status.startedAt,
        retryAfter: 30,
      },
      202
    );
  }
  return c.json(
    { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
    404
  );
}

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
    // Check registry and trigger auto-crawl if known
    const entry = registryStore.getById(id);
    if (entry) {
      triggerAutoCrawl(entry);
      const status = crawlTracker.getStatus(id);
      return c.json(
        {
          status: 'CRAWL_IN_PROGRESS',
          message: `Data for '${id}' is being fetched.`,
          progress: status ? { phase: status.progress.phase, total: status.progress.total, completed: status.progress.completed } : { phase: 'toc', total: 0, completed: 0 },
          startedAt: status?.startedAt || new Date().toISOString(),
          retryAfter: 30,
        },
        202
      );
    }
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  if (format === 'xml') {
    const xml = store.getCodeXml(id, path);
    if (!xml) return notFoundOrInProgress(c, id, path);
    c.header('Content-Type', 'application/xml');
    return c.body(xml);
  }

  if (format === 'html') {
    const html = store.getCodeHtml(id, path);
    if (!html) return notFoundOrInProgress(c, id, path);
    c.header('Content-Type', 'text/html');
    return c.body(html);
  }

  // Default: plain text with rich context for agents
  const text = store.getCodeText(id, path);
  if (!text) return notFoundOrInProgress(c, id, path);

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
