# Open Legal Codes

Retrieve the text of US legal codes programmatically. Give it a jurisdiction and a code path, get the legislative text back.

```bash
# What does Mountain View's code say about dogs?
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "dog"

# Get the exact text of a section
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path chapter-5/article-i/section-sec.-5.1
```

## Why This Exists

There is no open, machine-readable source of US municipal law. The text is public domain ([Georgia v. Public.Resource.Org, 2020](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.)), but it's locked inside commercial publisher websites (Municode, American Legal) with no API or bulk download.

Open Legal Codes crawls these publishers, caches the results locally, and serves them through a REST API, CLI, and MCP server for AI agents.

## Quick Start

```bash
npm install
npm run dev          # Start API server at http://localhost:3100
```

### Crawl a Jurisdiction

Before you can query a jurisdiction, you need to crawl it:

```bash
# List available jurisdictions in a state
npx tsx src/cli.ts list --state CA

# Crawl a specific jurisdiction
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
```

## Using with AI Agents (MCP Server)

The MCP server exposes 5 tools for AI agents to look up legal codes directly:

| Tool | Description |
|------|-------------|
| `lookup_jurisdiction` | Find a jurisdiction by city/state |
| `list_jurisdictions` | List available jurisdictions |
| `get_table_of_contents` | Browse a jurisdiction's code structure |
| `get_code_text` | Retrieve the text of a specific code section |
| `search_code` | Search for keywords across a jurisdiction's code |

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "legal-codes": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/open-legal-codes"
    }
  }
}
```

### Example: Verifying Legal Claims

An AI agent can use this to verify its own claims against actual law text, reducing hallucination:

1. User asks: *"Can I have a dog in Mountain View?"*
2. Agent calls `search_code({ jurisdiction: "ca-mountain-view", query: "dog" })` to find relevant sections
3. Agent calls `get_code_text({ jurisdiction: "ca-mountain-view", path: "chapter-5/article-i/section-sec.-5.1" })` to read the actual law
4. Agent answers based on the real text — or flags if no relevant code is found

This is the core value: AI agents can ground their answers about local law in the actual legislative text rather than training data.

## CLI Reference

```bash
# Look up a specific code section
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path part-i/article-i/section-100

# Browse table of contents (default depth: 3)
npx tsx src/cli.ts toc --jurisdiction ca-mountain-view --depth 2

# Search for keywords in a jurisdiction's code
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "rental"

# Crawl a jurisdiction from its publisher
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view

# List available jurisdictions from Municode
npx tsx src/cli.ts list --state CA
```

## REST API

Base URL: `http://localhost:3100/api/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /jurisdictions` | List all jurisdictions (filter: `?state=CA&publisher=municode`) |
| `GET /jurisdictions/:id` | Get jurisdiction metadata |
| `GET /jurisdictions/:id/toc` | Table of contents (`?depth=2`) |
| `GET /jurisdictions/:id/toc/*path` | TOC subtree at a path |
| `GET /jurisdictions/:id/code/*path` | Code text (`?format=text\|xml\|html`) |
| `GET /jurisdictions/:id/search` | Keyword search (`?q=rental&limit=20`) |
| `GET /lookup` | Find jurisdiction (`?city=Mountain+View&state=CA`) |

### Example Response (Code Text)

```json
{
  "data": {
    "jurisdiction": "ca-mountain-view",
    "jurisdictionName": "Mountain View, CA",
    "path": "part-i/article-i/section-100",
    "num": "Section 100",
    "heading": "Name",
    "text": "The municipal corporation now existing and known as the City of Mountain View...",
    "lastCrawled": null
  },
  "meta": { "timestamp": "2026-03-08T21:00:00.000Z" }
}
```

## Architecture

```
Publisher APIs          Cache (filesystem)        Consumers
┌──────────────┐       ┌──────────────────┐      ┌─────────────────┐
│ Municode     │──┐    │ codes/           │      │ REST API        │
│ American Legal│──┼──▶│   {jurisdiction}/ │──▶──│ CLI             │
│ (future...)  │──┘    │     sections...   │      │ MCP Server      │
└──────────────┘       │     _meta.json    │      └─────────────────┘
                       │     _toc.json     │
                       └──────────────────┘
```

**Publisher adapters** handle retrieval from each commercial publisher. Results are **cached to the filesystem** with metadata. **Consumers** provide different interfaces to query the cached data.

### Publisher Support

The US municipal code market is dominated by three platforms under two parent companies:

| Publisher | Status | Coverage | Parent |
|-----------|--------|----------|--------|
| **Municode** | Working | ~4,200 municipalities | CivicPlus |
| **American Legal** | Stubbed | ~3,500 municipalities | ICC |
| **eCode360 (General Code)** | Not started | ~4,400 municipalities | ICC |

These three cover the vast majority of US municipal codes online (~8,000-10,000 jurisdictions total).

Adding a new publisher means implementing the `CrawlerAdapter` interface in `src/crawlers/`.

### Web App

A Next.js frontend for browsing codes is included in `web/`:

```bash
npm run dev           # Start API server (port 3100)
npm run web           # Start web app (port 3000)
```

The web app proxies API requests to the backend and includes agent usage instructions on every page.

## Production Deployment

The filesystem cache is designed to work well behind a CDN:

- **Static files on disk** — TOC trees, HTML, and XML files are static after crawl. Serve them via nginx or Caddy with aggressive cache headers.
- **CDN layer** — Put Cloudflare, CloudFront, or similar in front. Most requests are for cached code sections (static content).
- **Origin server** — Only the `/search` and `/lookup` endpoints require hitting the origin. Everything else can be served from cache/CDN.
- **No database needed** — Filesystem storage keeps the architecture simple. No SQLite, Postgres, or Redis required.

```
Client → CDN (Cloudflare) → Origin (Node.js + Hono)
                                    ↓
                              codes/ (filesystem)
```

For search at scale, consider pre-building a search index (e.g., writing a simple inverted index to disk during crawl) rather than scanning files at query time.

## Development

```bash
npm install              # Install dependencies
npm run dev              # Start dev server (port 3100, with watch)
npm run build            # Compile TypeScript to dist/
npm run typecheck        # Type-check without emitting
npm run test             # Run test suite (49 tests via vitest)
npm run test:watch       # Run tests in watch mode
npm run mcp              # Start MCP server (stdio transport)
```

## Legal

The text of the law is public domain. The Supreme Court ruled in [Georgia v. Public.Resource.Org (2020)](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.) that government-authored legal codes cannot be copyrighted.

This project's source code is MIT licensed.

## Contributing

This project needs help with:

1. **Publisher adapters** — integrations with American Legal, QCode, CodePublishing, Sterling Codifiers, General Code
2. **More jurisdictions** — crawl additional cities and contribute the cached data
3. **Search improvements** — inverted index for faster keyword search
4. **Text extraction** — better handling of edge cases in municipal code HTML
