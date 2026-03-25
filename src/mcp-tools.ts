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
import { getCaseLaw } from './caselaw/index.js';

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
    'list_codes',
    'List all codes available for a jurisdiction. Some jurisdictions have multiple codes (e.g. Code of Ordinances, Land Development Code). Returns code IDs you can use with other tools.',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "tx-austin"'),
    },
    async ({ jurisdiction }) => {
      const codes = store.listCodes(jurisdiction);
      if (codes.length === 0) {
        return { content: [{ type: 'text', text: `No codes found for '${jurisdiction}'. The jurisdiction may not have been crawled yet.` }] };
      }
      const lines = codes.map(c => `${c.codeId} — ${c.name}${c.isPrimary ? ' [primary]' : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_table_of_contents',
    'Get the table of contents for a jurisdiction\'s legal code. Use depth to limit how deep the tree goes. Returns section paths you can use with get_code_text.',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-mountain-view"'),
      code: z.string().optional().describe('Code ID within the jurisdiction (use list_codes to see available codes). Defaults to the primary code.'),
      path: z.string().optional().describe('Path to a subtree, e.g. "chapter-5/article-i"'),
      depth: z.number().optional().describe('Max depth of tree to return (default: 2)'),
    },
    async ({ jurisdiction, code, path, depth }) => {
      const toc = store.getToc(jurisdiction, code);
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
      code: z.string().optional().describe('Code ID within the jurisdiction. Defaults to the primary code.'),
    },
    async ({ jurisdiction, path, code }) => {
      const j = store.getJurisdiction(jurisdiction);
      if (!j) {
        return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found. Use list_jurisdictions to see available ones.` }] };
      }

      const text = store.getCodeText(jurisdiction, path, code);
      if (!text) {
        return { content: [{ type: 'text', text: `Code section '${path}' not found in '${jurisdiction}'. Use get_table_of_contents to browse available sections.` }] };
      }

      const url = permalinkUrl(j, path, code);
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
      code: z.string().optional().describe('Code ID within the jurisdiction. Defaults to searching all codes.'),
      state: z.string().optional().describe('Two-letter state code to filter cross-jurisdiction search, e.g. "CA"'),
      query: z.string().describe('Search terms to look for in code text'),
      max_results: z.number().optional().describe('Maximum results to return (default: 10)'),
    },
    async ({ jurisdiction, code, state, query, max_results }) => {
      const limit = max_results ?? 10;

      // Single-jurisdiction search
      if (jurisdiction) {
        const j = store.getJurisdiction(jurisdiction);
        if (!j) {
          return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found.` }] };
        }

        const results = store.search(jurisdiction, query, limit, code).map((r) => ({
          ...r,
          url: permalinkUrl(j, r.path, r.codeId),
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

  // ── get_case_law ──
  server.tool(
    'get_case_law',
    'Find court opinions that cite a specific code section. Returns case names, dates, courts, and links to full opinions on CourtListener. Works for federal and state statutes; not yet available for municipal codes.',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-gov", "us-usc-title-42"'),
      path: z.string().describe('Code section path, e.g. "title-2/.../section-12965"'),
      code: z.string().optional().describe('Code ID within the jurisdiction. Defaults to the primary code.'),
      limit: z.number().optional().default(10).describe('Max results to return (default 10)'),
    },
    async ({ jurisdiction: jurisdictionId, path, code, limit }) => {
      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        return { content: [{ type: 'text', text: `Jurisdiction "${jurisdictionId}" not found. Use lookup_jurisdiction to find the right ID.` }] };
      }

      const tocNode = store.getTocNode(jurisdictionId, path, code);

      try {
        const result = await getCaseLaw(jurisdiction, path, tocNode || undefined, { limit });

        if (!result.supported) {
          return { content: [{ type: 'text', text: `Case law lookup is not yet available for municipal codes (non-standardized citation formats). This works for federal and state statutes.` }] };
        }

        if (result.results.length === 0) {
          return { content: [{ type: 'text', text: `No citing opinions found for ${result.queries.map(q => q.label).join(', ')}.` }] };
        }

        const header = `${jurisdiction.name} — ${tocNode?.num || path}\nCitation queries: ${result.queries.map(q => q.label).join(', ')}\nTotal results: ${result.totalCount}\n`;
        const lines = result.results.map((r, i) =>
          `${i + 1}. ${r.caseName} (${r.court}, ${r.dateFiled})\n   ${r.citation}${r.citeCount ? ` — cited by ${r.citeCount} opinions` : ''}\n   ${r.url}`
        );

        return { content: [{ type: 'text', text: header + '\n' + lines.join('\n\n') }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
      }
    }
  );

  // ── get_annotations ──
  server.tool(
    'get_annotations',
    'Get external legal analysis and commentary references for a code section or court decision. Returns links to law firm analyses, government guidance, academic articles, and other resources. Provide either a path (for statute sections) or a cluster_id (for case law).',
    {
      jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-gov", "ca-mountain-view"'),
      path: z.string().optional().describe('Code section path, e.g. "part-i/section-100". Required for statute annotations.'),
      cluster_id: z.number().optional().describe('CourtListener cluster ID for case law annotations.'),
      code: z.string().optional().describe('Code ID within the jurisdiction. Defaults to the primary code.'),
      type: z.enum(['legal_analysis', 'government_guidance', 'academic', 'news', 'other']).optional().describe('Filter by annotation type'),
      limit: z.number().optional().default(20).describe('Max results to return (default 20)'),
    },
    async ({ jurisdiction: jurisdictionId, path, cluster_id, code, type, limit }) => {
      if (!path && cluster_id == null) {
        return { content: [{ type: 'text', text: 'Provide either a path (for statute sections) or a cluster_id (for case law).' }] };
      }

      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        return { content: [{ type: 'text', text: `Jurisdiction "${jurisdictionId}" not found. Use lookup_jurisdiction to find the right ID.` }] };
      }

      const annotations = store.listAnnotations({
        targetType: cluster_id != null ? 'caselaw' : 'section',
        jurisdictionId,
        path: path || undefined,
        clusterId: cluster_id ?? undefined,
        codeId: code || undefined,
        status: 'approved',
        type: type || undefined,
        limit,
      });

      const target = cluster_id != null ? `case law cluster ${cluster_id}` : path!;
      if (annotations.length === 0) {
        return { content: [{ type: 'text', text: `No external references found for ${jurisdiction.name} — ${target}.` }] };
      }

      const lines = annotations.map((a, i) =>
        `${i + 1}. ${a.title}\n   ${a.source_name ? a.source_name + ' — ' : ''}${a.annotation_type}\n   ${a.url}${a.description ? '\n   ' + a.description : ''}`
      );

      return { content: [{ type: 'text', text: `External references for ${jurisdiction.name} — ${target}\n\n${lines.join('\n\n')}` }] };
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
