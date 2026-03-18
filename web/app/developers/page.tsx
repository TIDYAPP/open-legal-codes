import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Developers — Open Legal Codes',
  description: 'Install via npm or Homebrew, use the REST API, MCP server, or CLI to access US legal codes.',
};

export default function DevelopersPage() {
  return (
    <div>
      <h1>Developers</h1>
      <p className="subtitle">
        No signup. No API key. No rate limits.
      </p>

      <h2>Install</h2>

      <h3>npm</h3>
      <div className="code-block">{`npm install -g open-legal-codes`}</div>
      <p className="text-sm text-muted mt-8 mb-8">
        Or with the TIDY-scoped package:
      </p>
      <div className="code-block">{`npm install -g @tidydotcom/open-legal-codes`}</div>

      <h3>Homebrew (macOS / Linux)</h3>
      <div className="code-block">{`brew install tidyapp/tap/open-legal-codes`}</div>

      <h3>curl (no install needed)</h3>
      <div className="code-block">{`# Search for a term
curl 'https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/search?q=dog&limit=5'

# Get a specific section
curl 'https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/code/chapter-5/article-i/section-sec.-5.1'

# Find a jurisdiction by name
curl 'https://openlegalcodes.org/api/v1/lookup?city=Mountain+View&state=CA'`}</div>

      <h3>npx (one-off, no install)</h3>
      <div className="code-block">{`npx open-legal-codes search --jurisdiction ca-mountain-view --query "dog"`}</div>

      <h2>REST API</h2>
      <p className="text-sm text-muted mb-8">
        Base URL: <code>https://openlegalcodes.org/api/v1</code>
      </p>
      <div className="code-block">{`GET /jurisdictions                              # List all jurisdictions
GET /jurisdictions?state=CA                     # Filter by state
GET /jurisdictions/:id                          # Jurisdiction metadata + availability status
GET /jurisdictions/:id/toc?depth=2              # Table of contents
GET /jurisdictions/:id/code/:path               # Section text + permalink
GET /jurisdictions/:id/search?q=parking         # Keyword search
GET /lookup?city=Mountain+View&state=CA         # Find by name`}</div>

      <h2>How caching works</h2>
      <p>
        Content is fetched from the publisher on first request and cached. If a jurisdiction
        hasn't been cached yet, the API returns <code>202</code> and begins fetching in the
        background. Poll using the <code>retryAfter</code> value (seconds) until you get
        a <code>200</code>. Subsequent requests are served instantly from cache.
      </p>
      <div className="code-block">{`# First request — not cached yet
GET /jurisdictions/ca-san-francisco/toc
→ 202  { "status": "CRAWL_IN_PROGRESS", "retryAfter": 30, "progress": { "phase": "toc", ... } }

# After ~30-60 seconds
GET /jurisdictions/ca-san-francisco/toc
→ 200  { "data": { "jurisdiction": "ca-san-francisco", "children": [...] } }`}</div>

      <h3>Lookup and discovery</h3>
      <p>
        The <code>/lookup</code> endpoint can find any US city or county by name — even
        jurisdictions not yet in the catalog. It searches the registry, then probes
        publishers (Municode, American Legal, eCode360) to discover who hosts the code. Once
        found, it triggers a crawl automatically.
      </p>
      <div className="code-block">{`GET /lookup?city=San+Francisco&state=CA    # City lookup
GET /lookup?county=Maui&state=HI           # County lookup
GET /lookup?address=306+Desert+Falls+East,+Palm+Desert,+CA  # Address lookup`}</div>

      <h3>Status endpoint</h3>
      <div className="code-block">{`GET /status    # Server health, registry size, cached count`}</div>

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
      "args": ["-y", "-p", "open-legal-codes", "open-legal-codes-mcp"]
    }
  }
}`}</div>
      <p className="text-sm text-muted mt-16">
        Tools: <code>lookup_jurisdiction</code>, <code>list_jurisdictions</code>, <code>get_table_of_contents</code>, <code>get_code_text</code>, <code>search_code</code>
      </p>

      <h2>CLI</h2>
      <p className="text-sm text-muted mb-8">
        After installing via npm or Homebrew:
      </p>
      <div className="code-block">{`open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
open-legal-codes query  --jurisdiction ca-mountain-view --path part-i/article-i/section-100
open-legal-codes toc    --jurisdiction ca-mountain-view --depth 2
open-legal-codes list   --state CA
open-legal-codes lookup --city "Mountain View" --state CA
open-legal-codes crawl  --jurisdiction ca-mountain-view   # warm the cache`}</div>
    </div>
  );
}
