export const metadata = {
  title: 'Developers — Open Legal Codes',
  description: 'REST API, MCP server, and CLI for US legal codes.',
};

export default function DevelopersPage() {
  return (
    <div>
      <h1>Developers</h1>
      <p className="subtitle">
        No signup. No API key. No rate limits.
      </p>

      <h2>REST API</h2>
      <p className="text-sm text-muted mb-8">
        Base URL: <code>https://openlegalcodes.org/api/v1</code>
      </p>
      <div className="code-block">{`GET /jurisdictions                              # List all jurisdictions
GET /jurisdictions?state=CA                     # Filter by state
GET /jurisdictions/:id                          # Jurisdiction metadata
GET /jurisdictions/:id/toc?depth=2              # Table of contents
GET /jurisdictions/:id/code/:path               # Section text + permalink
GET /jurisdictions/:id/search?q=parking         # Keyword search
GET /lookup?city=Mountain+View&state=CA         # Find by name`}</div>

      <h2>MCP Server</h2>
      <p className="text-sm text-muted mb-8">
        Add to your Claude Desktop or Claude Code config for direct tool access:
      </p>
      <div className="code-block">{`{
  "mcpServers": {
    "legal-codes": {
      "url": "https://openlegalcodes.org/mcp"
    }
  }
}`}</div>
      <p className="text-sm text-muted mt-16 mb-8">
        If your MCP client requires a local process instead of a URL:
      </p>
      <div className="code-block">{`{
  "mcpServers": {
    "legal-codes": {
      "command": "npx",
      "args": ["-y", "open-legal-codes-mcp"]
    }
  }
}`}</div>
      <p className="text-sm text-muted mt-16">
        Tools: <code>lookup_jurisdiction</code>, <code>list_jurisdictions</code>, <code>get_table_of_contents</code>, <code>get_code_text</code>, <code>search_code</code>
      </p>

      <h2>CLI</h2>
      <div className="code-block">{`npx open-legal-codes query  --jurisdiction ca-mountain-view --path part-i/article-i/section-100
npx open-legal-codes toc    --jurisdiction ca-mountain-view --depth 2
npx open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
npx open-legal-codes list   --state CA
npx open-legal-codes lookup --city "Mountain View" --state CA`}</div>
    </div>
  );
}
