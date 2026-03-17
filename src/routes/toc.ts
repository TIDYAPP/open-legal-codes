import { Hono } from 'hono';
import type { TocNode } from '../types.js';
import { store } from '../store/index.js';
import { BRANDING } from '../branding.js';
import { resolveJurisdiction, crawlingResponse, failedResponse, notFoundResponse, notFoundOrCrawling } from './resolve.js';

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

/**
 * GET /jurisdictions/:id/toc
 * Get the full table of contents tree for a jurisdiction's code.
 * Query params: ?depth=1 (limit depth)
 */
tocRoutes.get('/:id/toc', (c) => {
  const id = c.req.param('id');
  const depth = c.req.query('depth') ? parseInt(c.req.query('depth')!, 10) : undefined;

  const toc = store.getToc(id);
  if (!toc) {
    const resolved = resolveJurisdiction(id);
    if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
    if (resolved.status === 'failed') return failedResponse(c, resolved);
    if (resolved.status === 'crawling') return crawlingResponse(c, resolved);
    // cached but no TOC yet — check if still crawling
    return notFoundOrCrawling(c, id, `No table of contents available for '${id}'`);
  }

  const children = depth ? limitDepth(toc.children, depth) : toc.children;

  return c.json({
    data: { ...toc, children },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/**
 * GET /jurisdictions/:id/toc/*path
 * Get the TOC subtree rooted at a specific node.
 */
tocRoutes.get('/:id/toc/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/toc/')[1] || '';

  const resolved = resolveJurisdiction(id);
  if (resolved.status === 'not_found') return notFoundResponse(c, `Jurisdiction '${id}' not found`);
  if (resolved.status === 'failed') return failedResponse(c, resolved);
  if (resolved.status === 'crawling') return crawlingResponse(c, resolved);

  const toc = store.getToc(id);
  if (!toc) {
    return notFoundOrCrawling(c, id, `No table of contents available for '${id}'`);
  }

  const node = findNode(toc.children, path);
  if (!node) {
    return notFoundResponse(c, `Path '${path}' not found in '${id}'`);
  }

  return c.json({
    data: node,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
