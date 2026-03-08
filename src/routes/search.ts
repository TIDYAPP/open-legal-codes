import { Hono } from 'hono';
import type { TocNode } from '../types.js';
import { store } from '../store/index.js';

export const searchRoutes = new Hono();

/**
 * GET /jurisdictions/:id/search?q=rental&limit=20
 * Search for sections containing specific keywords within a jurisdiction's code.
 * Returns matching section paths, headings, and text snippets.
 */
searchRoutes.get('/:id/search', (c) => {
  const id = c.req.param('id');
  const query = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  if (!query) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Query parameter "q" is required' } },
      400
    );
  }

  const jurisdiction = store.getJurisdiction(id);
  if (!jurisdiction) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } },
      404
    );
  }

  const toc = store.getToc(id);
  if (!toc) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `No code data available for '${id}'` } },
      404
    );
  }

  const queryLower = query.toLowerCase();
  const queryLen = query.length;
  const matches: { path: string; num: string; heading: string; snippet: string }[] = [];

  function searchNodes(nodes: TocNode[]) {
    for (const node of nodes) {
      if (matches.length >= limit) return;
      if (node.hasContent) {
        const text = store.getCodeText(id, node.path);
        if (text && text.toLowerCase().includes(queryLower)) {
          const idx = text.toLowerCase().indexOf(queryLower);
          const start = Math.max(0, idx - 80);
          const end = Math.min(text.length, idx + queryLen + 80);
          const snippet =
            (start > 0 ? '...' : '') +
            text.slice(start, end) +
            (end < text.length ? '...' : '');
          matches.push({
            path: node.path,
            num: node.num,
            heading: node.heading,
            snippet,
          });
        }
      }
      if (node.children) searchNodes(node.children);
    }
  }

  searchNodes(toc.children);

  return c.json({
    data: {
      jurisdiction: id,
      jurisdictionName: jurisdiction.name,
      query,
      results: matches,
      total: matches.length,
    },
    meta: { timestamp: new Date().toISOString() },
  });
});
