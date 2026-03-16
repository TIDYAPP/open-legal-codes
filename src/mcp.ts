#!/usr/bin/env node

/**
 * Open Legal Codes — MCP Server (stdio transport)
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
 *         "url": "https://openlegalcodes.org/mcp"
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CodeStore } from './store/index.js';
import { createMcpServer } from './mcp-tools.js';

const store = new CodeStore();
store.initialize();

const server = createMcpServer(store);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
