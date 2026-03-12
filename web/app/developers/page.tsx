export const metadata = {
  title: 'Developers — Open Legal Codes',
  description: 'REST API, MCP server, CLI, and Claude Code integration.',
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
        Add to your Claude Desktop config for direct tool access:
      </p>
      <div className="code-block">{`{
  "mcpServers": {
    "legal-codes": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/open-legal-codes"
    }
  }
}`}</div>
      <p className="text-sm text-muted mt-16">
        Tools: <code>lookup_jurisdiction</code>, <code>list_jurisdictions</code>, <code>get_table_of_contents</code>, <code>get_code_text</code>, <code>search_code</code>
      </p>

      <h2>CLI</h2>
      <div className="code-block">{`npx tsx src/cli.ts query  --jurisdiction ca-mountain-view --path part-i/article-i/section-100
npx tsx src/cli.ts toc    --jurisdiction ca-mountain-view --depth 2
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "parking"
npx tsx src/cli.ts crawl  --jurisdiction ca-mountain-view
npx tsx src/cli.ts list   --state CA`}</div>

      <h2>Claude Code</h2>
      <p className="text-sm text-muted mb-8">
        Clone the repo and use built-in slash commands:
      </p>
      <div className="code-block">{`/query-code ca-mountain-view part-i/article-i/section-100
/search-codes ca-mountain-view "parking"
/crawl-jurisdiction ca-mountain-view`}</div>

      <h2>GitHub</h2>
      <p className="text-sm text-muted">
        Source code: <a href="https://github.com/mchusma/open-legal-codes" target="_blank" rel="noopener noreferrer">github.com/mchusma/open-legal-codes</a>
      </p>
    </div>
  );
}
