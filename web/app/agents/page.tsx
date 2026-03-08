export default function AgentsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-2">Use with AI Agents</h1>
      <p className="text-gray-600 mb-6">
        Open Legal Codes is designed for programmatic access. No signup, no API key, no rate limits.
        Every API response includes a direct URL to the relevant section so agents can provide verifiable links.
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">MCP Server (Claude Desktop)</h2>
        <p className="text-sm text-gray-600 mb-3">
          The MCP server lets AI agents look up legal codes directly. Add this to your Claude Desktop config:
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
        <p className="text-sm text-gray-600 mt-3">Available tools:</p>
        <ul className="text-sm text-gray-700 mt-2 space-y-1" style={{ paddingLeft: '1.5rem', listStyle: 'disc' }}>
          <li><code className="font-mono text-xs">lookup_jurisdiction</code> — Find a jurisdiction by city/state</li>
          <li><code className="font-mono text-xs">list_jurisdictions</code> — List available jurisdictions</li>
          <li><code className="font-mono text-xs">get_table_of_contents</code> — Browse code structure</li>
          <li><code className="font-mono text-xs">get_code_text</code> — Get the text of a specific section (includes permalink)</li>
          <li><code className="font-mono text-xs">search_code</code> — Search for keywords in a jurisdiction (results include links)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">REST API</h2>
        <p className="text-sm text-gray-600 mb-3">
          All data is available via HTTP. Base URL: <code className="font-mono text-xs">https://openlegalcodes.org/api/v1</code>
        </p>
        <div className="code-block">{`# List jurisdictions
GET https://openlegalcodes.org/api/v1/jurisdictions

# Get table of contents
GET https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/toc?depth=2

# Get code text (response includes permalink URL)
GET https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/code/part-i/article-i/section-100

# Search within a jurisdiction (results include links)
GET https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/search?q=rental

# Find a jurisdiction
GET https://openlegalcodes.org/api/v1/lookup?city=Mountain+View&state=CA`}</div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Claude Code</h2>
        <p className="text-sm text-gray-600 mb-3">
          Clone the repo and Claude Code auto-loads project context. Built-in skills:
        </p>
        <div className="code-block">{`# In the repo directory:
/query-code ca-mountain-view part-i/article-i/section-100
/search-codes ca-mountain-view "parking"
/crawl-jurisdiction ca-mountain-view`}</div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">CLI</h2>
        <div className="code-block">{`# Query a specific code section
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path part-i/article-i/section-100

# Browse table of contents
npx tsx src/cli.ts toc --jurisdiction ca-mountain-view --depth 2

# Search for keywords
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "parking"

# Crawl a new jurisdiction
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view

# List jurisdictions
npx tsx src/cli.ts list --state CA`}</div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Anti-Hallucination Workflow</h2>
        <p className="text-sm text-gray-600 mb-3">
          AI agents can verify their claims against actual law text, then provide users with a direct link to the statute:
        </p>
        <ol className="text-sm text-gray-700 space-y-2" style={{ paddingLeft: '1.5rem', listStyle: 'decimal' }}>
          <li>User asks: <em>&quot;Can I have a dog in Mountain View?&quot;</em></li>
          <li>
            Agent calls <code className="font-mono text-xs">search_code(jurisdiction: &quot;ca-mountain-view&quot;, query: &quot;dog&quot;)</code> to find relevant sections
          </li>
          <li>
            Agent calls <code className="font-mono text-xs">get_code_text(jurisdiction: &quot;ca-mountain-view&quot;, path: &quot;chapter-5/article-i/...&quot;)</code> to read the actual law
          </li>
          <li>Agent answers based on real legislative text and includes a link like <code className="font-mono text-xs">openlegalcodes.org/ca-mountain-view/chapter-5/article-i/...</code></li>
          <li>User can click the link to verify the law themselves — no trust required</li>
        </ol>
      </section>
    </div>
  );
}
