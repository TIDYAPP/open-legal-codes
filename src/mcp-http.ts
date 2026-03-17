/**
 * Streamable HTTP MCP transport for Open Legal Codes.
 *
 * Mounts at /mcp on the Hono server, enabling zero-install MCP access.
 * Clients configure: { "url": "https://openlegalcodes.org/mcp" }
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CodeStore } from './store/index.js';
import { createMcpServer } from './mcp-tools.js';

export function createMcpRoutes(store: CodeStore): Hono {
  const app = new Hono();

  // Each request gets its own stateless transport + server instance.
  // This is fine because all tools are read-only and fast.
  app.post('/', async (c) => {
    try {
      const server = createMcpServer(store);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      await server.connect(transport);

      const response = await transport.handleRequest(c.req.raw);
      return response;
    } catch (err: any) {
      console.error('[MCP] Request error:', err.message);
      return c.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, 500);
    }
  });

  // GET for SSE stream (optional, for server-initiated notifications)
  app.get('/', (c) => {
    return c.text('MCP Streamable HTTP endpoint. Use POST for JSON-RPC requests.', 405);
  });

  // DELETE session (no-op in stateless mode)
  app.delete('/', (c) => {
    return c.text('No session to delete (stateless mode).', 200);
  });

  return app;
}
