#!/usr/bin/env node

// Open Legal Codes — MCP Server (API-backed)
//
// A stdio MCP server that calls the live REST API at openlegalcodes.org.
// No local filesystem access needed.
//
// Configure in claude_desktop_config.json:
//   {
//     "mcpServers": {
//       "legal-codes": {
//         "command": "npx",
//         "args": ["open-legal-codes-mcp"]
//       }
//     }
//   }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiClient, isCrawling } from './api-client.js';
import type { TocNode } from './api-client.js';

const client = new ApiClient();

const server = new McpServer({
  name: 'open-legal-codes',
  version: '0.1.0',
});

// --- Tools ---

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
      return { content: [{ type: 'text' as const, text: 'Provide at least a query, state, or type.' }] };
    }

    const result = await client.listJurisdictions({ state: state || undefined, type: type || undefined });
    if (isCrawling(result)) {
      return { content: [{ type: 'text' as const, text: 'Data is being loaded. Try again in ~30 seconds.' }] };
    }

    let results = result;
    if (query) {
      const queryLower = query.toLowerCase();
      results = results.filter((j) => j.name.toLowerCase().includes(queryLower) || j.id.includes(queryLower));
    }

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No jurisdictions found matching query=${query || ''} state=${state || ''} type=${type || ''}` }] };
    }

    const lines = results.map((j) => `${j.id} — ${j.name} (${j.publisher.name})`);
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
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
    const result = await client.listJurisdictions({ state: state || undefined, type: type || undefined });
    if (isCrawling(result)) {
      return { content: [{ type: 'text' as const, text: 'Data is being loaded. Try again in ~30 seconds.' }] };
    }

    if (result.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No jurisdictions available.' }] };
    }

    const lines = result.map((j) => `${j.id} — ${j.name}`);
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
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
    const result = await client.getToc(jurisdiction, { depth: depth ?? 2, path: path || undefined });
    if (isCrawling(result)) {
      return { content: [{ type: 'text' as const, text: 'This jurisdiction is being loaded. Try again in ~30 seconds.' }] };
    }

    if (!result || result.children.length === 0) {
      return { content: [{ type: 'text' as const, text: `No table of contents found for '${jurisdiction}'. Use list_jurisdictions to see available ones.` }] };
    }

    const lines: string[] = [];
    const maxDepth = depth ?? 2;
    formatTocNodes(result.children, lines, 0, maxDepth);

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
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
    const result = await client.getCodeText(jurisdiction, path);
    if (isCrawling(result)) {
      return { content: [{ type: 'text' as const, text: 'This jurisdiction is being loaded. Try again in ~30 seconds.' }] };
    }

    const url = result.url || `https://openlegalcodes.org/${jurisdiction}/${path}`;
    return {
      content: [{
        type: 'text' as const,
        text: `${result.jurisdictionName} — ${path}\nSource: ${url}\n\n${result.text}`,
      }],
    };
  }
);

server.tool(
  'search_code',
  'Search for sections containing specific terms within a jurisdiction\'s legal code.',
  {
    jurisdiction: z.string().describe('Jurisdiction ID, e.g. "ca-mountain-view"'),
    query: z.string().describe('Search terms to look for in code text'),
    max_results: z.number().optional().describe('Maximum results to return (default: 10)'),
  },
  async ({ jurisdiction, query, max_results }) => {
    const result = await client.search(jurisdiction, query, { limit: max_results ?? 10 });
    if (isCrawling(result)) {
      return { content: [{ type: 'text' as const, text: 'This jurisdiction is being loaded. Try again in ~30 seconds.' }] };
    }

    if (result.length === 0) {
      return { content: [{ type: 'text' as const, text: `No sections found matching "${query}" in ${jurisdiction}.` }] };
    }

    const lines = result.map((m) =>
      `${m.path}\n  ${m.num} ${m.heading}\n  ${m.url}\n  ${m.snippet}`
    );
    return { content: [{ type: 'text' as const, text: lines.join('\n\n') }] };
  }
);

// --- Helpers ---

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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
