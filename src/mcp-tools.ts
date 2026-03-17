/**
 * Shared MCP tool definitions for Open Legal Codes.
 *
 * Used by both the stdio MCP server (src/mcp.ts) and the
 * HTTP Streamable transport (src/mcp-http.ts).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CodeStore } from './store/index.js';
import { registryStore } from './registry/store.js';
import type { TocNode } from './types.js';
import { BRANDING } from './branding.js';
import { permalinkUrl } from './permalink.js';

export function createMcpServer(store: CodeStore): McpServer {
  const server = new McpServer({
    name: 'open-legal-codes',
    version: '0.1.0',
  }, {
    instructions: BRANDING.mcpInstructions,
  });

  server.tool(
    'lookup_jurisdiction',
    'Find a jurisdiction by name, state, or type. Returns matching jurisdiction IDs you can use with other tools.',
    {
      query: z.string().optional().describe('Name to search for, e.g. "Mountain View", "Civil Code", "Housing"'),
      state: z.string().optional().describe('Two-letter state code, e.g. "CA"'),
      type: z.enum(['federal', 'state', 'county', 'city']).optional().describe('Jurisdiction type'),
    },
    async ({ query, state, type }) => {
      if (!query && !state && !type) {
        return { content: [{ type: 'text', text: 'Provide at least a query, state, or type.' }] };
      }

      // Search cached jurisdictions first
      let cached = store.listJurisdictions({ state: state || undefined, type: type || undefined });
      if (query) {
        const queryLower = query.toLowerCase();
        cached = cached.filter((j) => j.name.toLowerCase().includes(queryLower) || j.id.includes(queryLower));
      }

      if (cached.length > 0) {
        const lines = cached.map((j) => `${j.id} — ${j.name} (${j.publisher.name}) [cached]`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Fall back to registry (full catalog)
      let registryResults = query
        ? registryStore.findByName(query, state || undefined)
        : registryStore.query({ state: state || undefined, type: type || undefined });
      if (type) registryResults = registryResults.filter(e => e.type === type);
      const top = registryResults.slice(0, 20);

      if (top.length === 0) {
        return { content: [{ type: 'text', text: `No jurisdictions found matching query=${query || ''} state=${state || ''} type=${type || ''}` }] };
      }

      const lines = top.map((e) => `${e.id} — ${e.name} (${e.publisher}) [${e.status}]`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'list_jurisdictions',
    'List all available jurisdictions, optionally filtered by state or type (federal, state, county, city).',
    {
      state: z.string().optional().describe('Two-letter state code to filter by, e.g. "CA"'),
      type: z.enum(['federal', 'state', 'county', 'city']).optional().describe('Jurisdiction type to filter by'),
    },
    async ({ state, type }) => {
      const results = store.listJurisdictions({ state: state || undefined, type: type || undefined });

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No jurisdictions available.' }] };
      }

      const lines = results.map((j) => `${j.id} — ${j.name}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_table_of_contents',
    'Get the table of contents for a jurisdiction\'s legal code. Use depth to limit how deep the tree goes. Returns section paths you can use with get_code_text.',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-mountain-view"'),
      path: z.string().optional().describe('Path to a subtree, e.g. "chapter-5/article-i"'),
      depth: z.number().optional().describe('Max depth of tree to return (default: 2)'),
    },
    async ({ jurisdiction, path, depth }) => {
      const toc = store.getToc(jurisdiction);
      if (!toc) {
        return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found. Use list_jurisdictions to see available ones.` }] };
      }

      let nodes = toc.children;
      if (path) {
        const node = findNode(nodes, path);
        if (!node) {
          return { content: [{ type: 'text', text: `Path '${path}' not found in '${jurisdiction}'.` }] };
        }
        nodes = [node];
      }

      const maxDepth = depth ?? 2;
      const lines: string[] = [];
      formatTocNodes(nodes, lines, 0, maxDepth);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_code_text',
    'Retrieve the text of a specific legal code section. Returns the plain text content of the law.',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-mountain-view"'),
      path: z.string().describe('Code path, e.g. "part-i/article-i/section-100"'),
    },
    async ({ jurisdiction, path }) => {
      const j = store.getJurisdiction(jurisdiction);
      if (!j) {
        return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found. Use list_jurisdictions to see available ones.` }] };
      }

      const text = store.getCodeText(jurisdiction, path);
      if (!text) {
        return { content: [{ type: 'text', text: `Code section '${path}' not found in '${jurisdiction}'. Use get_table_of_contents to browse available sections.` }] };
      }

      const url = permalinkUrl(j, path);
      return {
        content: [{
          type: 'text',
          text: `${j.name} — ${path}\nSource: ${url}\n\n${text}`,
        }],
      };
    }
  );

  server.tool(
    'search_code',
    'Search for sections containing specific terms. Provide a jurisdiction ID to search within one jurisdiction, or omit it to search across all cached jurisdictions (optionally filtered by state).',
    {
      jurisdiction: z.string().optional().describe('Jurisdiction ID, e.g. "ca-mountain-view". Omit to search across all cached jurisdictions.'),
      state: z.string().optional().describe('Two-letter state code to filter cross-jurisdiction search, e.g. "CA"'),
      query: z.string().describe('Search terms to look for in code text'),
      max_results: z.number().optional().describe('Maximum results to return (default: 10)'),
    },
    async ({ jurisdiction, state, query, max_results }) => {
      const limit = max_results ?? 10;

      // Single-jurisdiction search
      if (jurisdiction) {
        const j = store.getJurisdiction(jurisdiction);
        if (!j) {
          return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found.` }] };
        }

        const results = store.search(jurisdiction, query, limit).map((r) => ({
          ...r,
          url: permalinkUrl(j, r.path),
        }));

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No sections found matching "${query}" in ${jurisdiction}.` }] };
        }

        const lines = results.map((m) =>
          `${m.path}\n  ${m.num} ${m.heading}\n  ${m.url}\n  ${m.snippet}`
        );
        return { content: [{ type: 'text', text: lines.join('\n\n') }] };
      }

      // Cross-jurisdiction search
      const jurisdictions = store.listJurisdictions({ state: state || undefined });
      const allResults: Array<{ jurisdictionId: string; jurisdictionName: string; path: string; num: string; heading: string; snippet: string; url: string }> = [];

      for (const j of jurisdictions) {
        if (!store.hasSearchIndex(j.id)) continue;
        const results = store.search(j.id, query, limit);
        for (const r of results) {
          allResults.push({
            jurisdictionId: j.id,
            jurisdictionName: j.name,
            ...r,
            url: permalinkUrl(j, r.path),
          });
          if (allResults.length >= limit) break;
        }
        if (allResults.length >= limit) break;
      }

      if (allResults.length === 0) {
        const scope = state ? `cached jurisdictions in ${state}` : 'all cached jurisdictions';
        return { content: [{ type: 'text', text: `No sections found matching "${query}" across ${scope}.` }] };
      }

      const lines = allResults.map((m) =>
        `[${m.jurisdictionName}] ${m.path}\n  ${m.num} ${m.heading}\n  ${m.url}\n  ${m.snippet}`
      );
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  return server;
}

// --- Helpers ---

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

function formatTocNodes(nodes: TocNode[], lines: string[], depth: number, maxDepth: number) {
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const content = node.hasContent ? ' [has content]' : '';
    const heading = node.heading ? ` — ${node.heading}` : '';
    lines.push(`${indent}${node.path}: ${node.num}${heading}${content}`);
    if (node.children && depth < maxDepth - 1) {
      formatTocNodes(node.children, lines, depth + 1, maxDepth);
    }
  }
}
