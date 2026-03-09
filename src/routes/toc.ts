import { Hono } from 'hono';
import type { TocNode } from '../types.js';
import { store } from '../store/index.js';
import { crawlTracker } from '../crawl-tracker.js';

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
    const jurisdiction = store.getJurisdiction(id);
    if (!jurisdiction) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
        404
      );
    }
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
      { error: { code: 'NOT_FOUND', message: `No table of contents available for '${id}'` } },
      404
    );
  }

  const children = depth ? limitDepth(toc.children, depth) : toc.children;

  return c.json({
    data: { ...toc, children },
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * GET /jurisdictions/:id/toc/*path
 * Get the TOC subtree rooted at a specific node.
 */
tocRoutes.get('/:id/toc/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/toc/')[1] || '';

  const jurisdiction = store.getJurisdiction(id);
  if (!jurisdiction) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  const toc = store.getToc(id);
  if (!toc) {
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
      { error: { code: 'NOT_FOUND', message: `No table of contents available for '${id}'` } },
      404
    );
  }

  const node = findNode(toc.children, path);
  if (!node) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Path '${path}' not found in '${id}'` } },
      404
    );
  }

  return c.json({
    data: node,
    meta: { timestamp: new Date().toISOString() },
  });
});
