import { Hono } from 'hono';
import type { Context } from 'hono';
import type { TocNode } from '../types.js';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { resolveJurisdiction, crawlingResponse, crawlFailedResponse, notFoundResponse, notFoundOrCrawling } from './resolve.js';

export const tocRoutes = new Hono();

/** Limit tree depth by pruning children beyond maxDepth */
function limitDepth(nodes: TocNode[], maxDepth: number, current = 1): TocNode[] {
  return nodes.map((node) => ({
    ...node,
    children: current >= maxDepth ? [] : limitDepth(node.children || [], maxDepth, current + 1),
  }));
}

/** Walk a TOC tree to find the node at a given path */
function findNode(nodes: TocNode[], targetPath: string): TocNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (targetPath.startsWith(node.path + '/') && node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

function handleTocRequest(c: Context, id: string, codeId?: string) {
  const depth = c.req.query('depth') ? parseInt(c.req.query('depth')!, 10) : undefined;

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
  if (resolved.status === 'crawl_failed') return crawlFailedResponse(c, resolved);

  const toc = store.getToc(id, codeId);
  if (!toc) return notFoundOrCrawling(c, id, `No table of contents available for '${id}'`);

  const children = depth ? limitDepth(toc.children, depth) : toc.children;

  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
  return c.json({
    data: { ...toc, children },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
}

function handleTocSubtreeRequest(c: Context, id: string, path: string, codeId?: string) {
  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
  if (resolved.status === 'crawl_failed') return crawlFailedResponse(c, resolved);

  const toc = store.getToc(id, codeId);
  if (!toc) return notFoundOrCrawling(c, id, `No table of contents available for '${id}'`);

  const node = findNode(toc.children, path);
  if (!node) return notFoundResponse(c, `Path '${path}' not found in '${id}'`);

  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
  return c.json({
    data: node,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
}

/** GET /jurisdictions/:id/codes — list all codes for a jurisdiction */
tocRoutes.get('/:id/codes', (c) => {
  const id = c.req.param('id');

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
  if (resolved.status === 'crawl_failed') return crawlFailedResponse(c, resolved);

  const codes = store.listCodes(id);

  c.header('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=604800');
  return c.json({
    data: codes,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/** GET /jurisdictions/:id/toc — default code */
tocRoutes.get('/:id/toc', (c) => {
  return handleTocRequest(c, c.req.param('id'));
});

/** GET /jurisdictions/:id/toc/*path — default code subtree */
tocRoutes.get('/:id/toc/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/toc/')[1] || '';
  return handleTocSubtreeRequest(c, id, path);
});

/** GET /jurisdictions/:id/codes/:codeId/toc — specific code */
tocRoutes.get('/:id/codes/:codeId/toc', (c) => {
  return handleTocRequest(c, c.req.param('id'), c.req.param('codeId'));
});

/** GET /jurisdictions/:id/codes/:codeId/toc/*path — specific code subtree */
tocRoutes.get('/:id/codes/:codeId/toc/*', (c) => {
  const id = c.req.param('id');
  const codeId = c.req.param('codeId');
  const fullPath = c.req.path;
  const tocSegment = `/codes/${codeId}/toc/`;
  const idx = fullPath.indexOf(tocSegment);
  const path = idx >= 0 ? fullPath.slice(idx + tocSegment.length) : '';
  return handleTocSubtreeRequest(c, id, path, codeId);
});
