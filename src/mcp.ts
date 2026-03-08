#!/usr/bin/env node

/**
 * Open Legal Codes — MCP Server
 *
 * Exposes legal code lookup tools via the Model Context Protocol,
 * allowing AI agents to query US legal codes directly.
 *
 * Usage:
 *   npx tsx src/mcp.ts
 *
 * Configure in claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "legal-codes": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp.ts"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CodeStore } from './store/index.js';
import type { TocNode } from './types.js';

const store = new CodeStore();
store.initialize();

const server = new McpServer({
  name: 'open-legal-codes',
  version: '0.1.0',
});

// --- Tools ---

server.tool(
  'lookup_jurisdiction',
  'Find a jurisdiction by city and/or state. Returns matching jurisdiction IDs you can use with other tools.',
  {
    city: z.string().optional().describe('City name, e.g. "Mountain View"'),
    state: z.string().optional().describe('Two-letter state code, e.g. "CA"'),
  },
  async ({ city, state }) => {
    if (!city && !state) {
      return { content: [{ type: 'text', text: 'Provide at least a city or state.' }] };
    }

    let results = store.listJurisdictions({ state: state || undefined });
    if (city) {
      const cityLower = city.toLowerCase();
      results = results.filter((j) => j.name.toLowerCase().includes(cityLower));
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No jurisdictions found matching city=${city || ''} state=${state || ''}` }] };
    }

    const lines = results.map((j) => `${j.id} — ${j.name} (${j.publisher.name})`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

server.tool(
  'list_jurisdictions',
  'List all available jurisdictions, optionally filtered by state.',
  {
    state: z.string().optional().describe('Two-letter state code to filter by, e.g. "CA"'),
  },
  async ({ state }) => {
    const results = store.listJurisdictions({ state: state || undefined });

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

    return {
      content: [{
        type: 'text',
        text: `${j.name} — ${path}\n\n${text}`,
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
    const j = store.getJurisdiction(jurisdiction);
    if (!j) {
      return { content: [{ type: 'text', text: `Jurisdiction '${jurisdiction}' not found.` }] };
    }

    const limit = max_results ?? 10;
    const results = store.search(jurisdiction, query, limit);

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No sections found matching "${query}" in ${jurisdiction}.` }] };
    }

    const lines = results.map((m) =>
      `${m.path}\n  ${m.num} ${m.heading}\n  ${m.snippet}`
    );
    return { content: [{ type: 'text', text: lines.join('\n\n') }] };
  }
);

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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
