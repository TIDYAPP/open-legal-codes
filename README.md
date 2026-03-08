# Open Legal Codes

**Know what the law actually says.** Open Legal Codes retrieves the current text of US municipal codes from publisher websites, caches them locally, and serves them through a REST API, CLI, and MCP server. No signup, no API key.

Live at [openlegalcodes.org](https://openlegalcodes.org).

## The Problem

US municipal law is public domain ([Georgia v. Public.Resource.Org, 2020](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.)), but there's no open, machine-readable way to access it. The text is locked behind commercial publisher websites (Municode, American Legal, General Code) with no API or bulk download.

If an AI agent tells you "Mountain View prohibits keeping more than 3 dogs," there's no way to verify that against the actual law text — until now.

## Quick Start

```bash
git clone https://github.com/mchusma/open-legal-codes.git
cd open-legal-codes
npm install
npm run dev          # API server at http://localhost:3100
```

Crawl a jurisdiction, then query it:

```bash
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "dog"
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path chapter-5/article-i/section-sec.-5.1
```

## How It Works

1. **First request for a jurisdiction**: scrapes the publisher's site, caches the results locally. Takes up to ~1 minute.
2. **Subsequent requests**: served from cache in milliseconds.
3. **The more people use a jurisdiction, the faster it gets** — the cache stays warm.

If you plan to use a specific jurisdiction, hit it once in advance to warm the cache:
```bash
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
```

Search is exact text matching — not semantic search. If an LLM claims "the law says X," you can search for those exact words to verify whether the law actually says that.

## Point Your AI Agent at This

The primary use case is AI agents that need to ground their answers in actual law text instead of training data.

### Claude Desktop (MCP Server)

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

Available tools:

| Tool | What it does |
|------|-------------|
| `lookup_jurisdiction` | Find a jurisdiction by city/state |
| `list_jurisdictions` | List available jurisdictions |
| `get_table_of_contents` | Browse a jurisdiction's code structure |
| `get_code_text` | Get the text of a specific code section |
| `search_code` | Exact keyword search within a jurisdiction |

### Claude Code

Clone the repo and use the built-in skills:

```bash
# In the repo directory, Claude Code auto-loads project context via CLAUDE.md
# Skills available: /query-code, /search-codes, /crawl-jurisdiction
```

### Any HTTP Client

```bash
# Search for a term
curl 'https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/search?q=dog&limit=10'

# Get specific section text
curl 'https://openlegalcodes.org/api/v1/jurisdictions/ca-mountain-view/code/chapter-5/article-i/section-sec.-5.1'

# Find a jurisdiction
curl 'https://openlegalcodes.org/api/v1/lookup?city=Mountain+View&state=CA'
```

### Anti-Hallucination Workflow

This is the core value — agents can verify their own claims:

1. User asks: *"Can I have a dog in Mountain View?"*
2. Agent calls `search_code(jurisdiction: "ca-mountain-view", query: "dog")` → finds relevant sections
3. Agent calls `get_code_text(jurisdiction: "ca-mountain-view", path: "chapter-5/article-i/...")` → reads the actual law
4. Agent answers based on the real legislative text
5. **If search returns nothing, the agent flags it** rather than making something up

## REST API

Base URL: `https://openlegalcodes.org/api/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /jurisdictions` | List jurisdictions (filter: `?state=CA&publisher=municode`) |
| `GET /jurisdictions/:id` | Jurisdiction metadata |
| `GET /jurisdictions/:id/toc` | Table of contents (`?depth=2`) |
| `GET /jurisdictions/:id/toc/*path` | TOC subtree at a path |
| `GET /jurisdictions/:id/code/*path` | Code text (`?format=text\|xml\|html`) |
| `GET /jurisdictions/:id/search` | Keyword search (`?q=rental&limit=20`) |
| `GET /lookup` | Find jurisdiction (`?city=Mountain+View&state=CA`) |

Example response:
```json
{
  "data": {
    "jurisdiction": "ca-mountain-view",
    "jurisdictionName": "Mountain View, CA",
    "path": "chapter-5/article-i/section-sec.-5.1",
    "num": "Sec. 5.1",
    "heading": "Definitions",
    "text": "Animal means any vertebrate member of the animal kingdom...",
    "url": "https://openlegalcodes.org/ca-mountain-view/chapter-5/article-i/section-sec.-5.1",
    "lastCrawled": "2026-03-08T12:00:00.000Z"
  }
}
```

## CLI Reference

```bash
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
npx tsx src/cli.ts toc --jurisdiction ca-mountain-view --depth 2
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "rental"
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
npx tsx src/cli.ts list --state CA
```

## Architecture

```
Publisher APIs          Cache (filesystem)        Consumers
┌──────────────┐       ┌──────────────────┐      ┌─────────────────┐
│ Municode     │──┐    │ codes/           │      │ REST API        │
│ American Legal│──┼──▶│   {jurisdiction}/ │──▶──│ CLI             │
│ (future...)  │──┘    │     sections...   │      │ MCP Server      │
└──────────────┘       │     _meta.json    │      │ Web UI          │
                       │     _toc.json     │      └─────────────────┘
                       └──────────────────┘
```

- **Publisher adapters** (`src/crawlers/`) handle each publisher's quirks
- **Cache** is filesystem-based — no database needed
- **Search index** is built in memory at startup for fast keyword search
- **CDN-ready** — static code sections are cacheable; only `/search` and `/lookup` need origin

### Publisher Coverage

| Publisher | Status | Coverage | Parent |
|-----------|--------|----------|--------|
| **Municode** | Working | ~4,200 municipalities | CivicPlus |
| **American Legal** | Adapter built | ~3,500 municipalities | ICC |
| **eCode360 (General Code)** | Not started | ~4,400 municipalities | ICC |

These three cover the vast majority of US municipal codes (~8,000-10,000 jurisdictions).

## Development

```bash
npm install              # Install dependencies
npm run dev              # Dev server (port 3100, watch mode)
npm run build            # Compile TypeScript
npm run typecheck        # Type-check without emitting
npm run test             # Run tests (59 tests, vitest)
npm run test:watch       # Tests in watch mode
npm run mcp              # MCP server (stdio transport)
npm run web              # Web UI (port 3000)
```

## Production Deployment

```
Client → CDN (Cloudflare) → Origin (Node.js + Hono) → codes/ (filesystem)
```

- Static code sections are CDN-cacheable with long TTLs
- Only `/search` and `/lookup` hit origin
- No database — the filesystem cache is the database
- Pre-warm jurisdictions you care about with `crawl`

## Contributing

Ideas that would help:

- **Smarter caching** — cache until the law changes, then refresh (instead of time-based expiry)
- **More publisher adapters** — eCode360, QCode, CodePublishing, Sterling Codifiers
- **Missing jurisdictions** — crawl and contribute new cities
- **Better text extraction** — edge cases in municipal code HTML

Submit a PR. If you have ideas for improvement, open an issue.

## Legal

The text of the law is public domain. The Supreme Court ruled in [Georgia v. Public.Resource.Org (2020)](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.) that government-authored legal codes cannot be copyrighted. We're not replacing publishers — we're making it easy for everyone to know what the laws actually are.

This project's source code is MIT licensed.
