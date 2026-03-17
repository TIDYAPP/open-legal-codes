# CLAUDE.md

## Project Goal

Open Legal Codes makes it easy to know what US municipal laws actually say right now. Given a jurisdiction and a code path, it returns the current text of that law. It retrieves content from commercial publishers (Municode, American Legal, etc.), caches results locally, and serves them through a REST API, CLI, and MCP server.

Live at [openlegalcodes.org](https://openlegalcodes.org).

The primary consumers are AI agents that need to verify their claims against actual legislative text. Every response includes a permalink URL so agents can provide users with a direct link to the statute.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start dev server (port 3100, with watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server
npm run typecheck        # Type-check without emitting
npm run test             # Run test suite (vitest)
npm run test:watch       # Run tests in watch mode
npm run mcp              # Start MCP server (stdio transport)
npm run web              # Start Next.js frontend (port 3000)
npm run web:build        # Build Next.js frontend
```

### CLI

```bash
npx tsx src/cli.ts query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
npx tsx src/cli.ts toc --jurisdiction ca-mountain-view --depth 2
npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "parking"
npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
npx tsx src/cli.ts list --state CA
```

### Claude Code Skills

This repo includes `.claude/skills/` for Claude Code integration:
- `/query-code [jurisdiction] [path]` — look up a specific section
- `/search-codes [jurisdiction] [query]` — search for keywords
- `/crawl-jurisdiction [jurisdiction]` — warm the cache

### MCP Server

5 tools for AI agents: `lookup_jurisdiction`, `list_jurisdictions`, `get_table_of_contents`, `get_code_text`, `search_code`.

Configure in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "legal-codes": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"]
    }
  }
}
```

## Architecture

```
Publisher Adapters → Cache (filesystem) → Consumers (API / CLI / MCP / Web)
```

### Publisher Adapters (`src/crawlers/`)

Each publisher gets its own adapter implementing `CrawlerAdapter` (defined in `src/crawlers/types.ts`):
- `listJurisdictions(state?)` — list available jurisdictions
- `fetchToc(sourceId)` — get table of contents hierarchy
- `fetchSection(sourceId, sectionId)` — get section content (HTML)

**Implemented**: Municode (`municode.ts`) — uses their JSON API at `api.municode.com`
**Adapter built**: American Legal (`amlegal.ts`) — extracts Redux state from HTML, no Playwright needed
**Adapter built**: eCFR (`ecfr.ts`) — free REST API for all 50 CFR titles (federal regulations)
**Adapter built**: eCode360 (`ecode360.ts`) — HTML scraper for ~4,400 municipal/county codes
**Adapter built**: CA Leginfo (`ca-leginfo.ts`) — scrapes California's 30 state statute codes
**Adapter built**: NY Open Legislation (`ny-openleg.ts`) — JSON API for all New York state laws (requires free API key via `NY_OPENLEG_API_KEY`)

The crawl pipeline (`pipeline.ts`) orchestrates: fetch TOC → transform → fetch all sections → write to cache.

### Cache (`codes/` + `src/store/`)

Filesystem-based. Each jurisdiction gets a directory under `codes/`:
- `_meta.json` — jurisdiction metadata, source info
- `_toc.json` — table of contents tree
- `{path}.html` — original HTML from publisher
- `{path}.xml` — converted XML

`CodeStore` (`src/store/index.ts`) provides read access with an in-memory search index.

### How Caching Works

- **First request**: scrapes the publisher, caches to disk. Takes up to ~1 minute.
- **Subsequent requests**: served from cache in milliseconds.
- **The more a jurisdiction is used, the faster it gets.**

### HTTP API (`src/routes/`)

Base URL: `https://openlegalcodes.org/api/v1`

- `GET /jurisdictions` — list jurisdictions from registry (37k+ catalog, paginated with `?limit=&offset=`; filter by `?type=&state=&publisher=&q=`; use `?cached=true` for ready-only)
- `GET /jurisdictions/:id` — single jurisdiction metadata
- `GET /jurisdictions/:id/toc` — table of contents (with `?depth=N`)
- `GET /jurisdictions/:id/code/*path` — code content (includes `url` permalink)
- `GET /jurisdictions/:id/search?q=keyword` — keyword search (results include `url` links)
- `GET /search?q=keyword&state=CA` — cross-jurisdiction keyword search (searches all cached jurisdictions)
- `GET /lookup?city=X&state=Y` — find jurisdiction by name
- `GET /lookup?county=X&state=Y` — find county jurisdiction by name

### Converter (`src/converter/`)

HTML-to-XML conversion. Not the current priority — text retrieval matters more than output format.

## Key Design Principles

- **Text retrieval first, fancy formats later.** The priority is getting legal text back reliably.
- **Adapter pattern for publishers.** Each publisher's quirks are isolated in its own adapter.
- **Cache with timestamps, not full versioning.** We cache content and track when it was last retrieved.
- **Every response includes a permalink.** Agents should provide users with links to verify the law themselves.
- **Architect for agent consumption.** The primary consumers are AI agents, not browsers.
- **US only for now.** Don't over-generalize for international codes yet.
- **Keep it simple.** Avoid over-engineering.

## Current State

### Publisher Adapters
- Municode crawler: **working** — can crawl full municipal codes (cities + counties)
- American Legal crawler: **adapter built** — Redux state extraction from HTML
- eCFR crawler: **adapter built** — free REST API, all 50 CFR titles, no key needed
- eCode360 crawler: **adapter built** — HTML scraper with cheerio (cities + counties)
- CA Leginfo crawler: **adapter built** — scrapes all 30 CA codes, public domain data
- NY Open Legislation crawler: **adapter built** — JSON API for all NY state laws (free API key required)

### Coverage by Jurisdiction Type
- **Federal**: CFR via eCFR API (all 49 titles available, 3 pre-cached)
- **State**: California statutes via leginfo, New York statutes via Open Legislation API
- **County**: Detected from Municode/eCode360 client names, county lookup via `/lookup?county=X&state=Y`
- **City/Municipal**: Municode + American Legal + eCode360

### Infrastructure
- Cache/storage: **working** — reads and writes jurisdiction data
- HTTP API routes: **working** — all responses include permalink URLs
- CLI: **working** — query, toc, search, crawl, list commands; supports all publishers via `--publisher`
- MCP server: **working** — 5 tools with type/query filters, responses include source URLs
- Web app: **working** — Next.js in `web/`, browse/search/view codes
- Claude Code skills: **working** — `.claude/skills/` for query, search, crawl
- Tests: **working** — 118 tests across 12 test files (vitest)
- Search: **working** — in-memory index, exact keyword matching, cross-jurisdiction search via `/search?q=&state=`
- Deployment: **ready** — Dockerfile, docker-compose, Caddy, GitHub Actions CI/CD
