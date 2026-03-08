# CLAUDE.md

## Project Goal

Open Legal Codes makes US legal codes machine-readable. The core use case: given a jurisdiction and a code path, return the text of that legal code. The project retrieves content from commercial publishers (Municode, American Legal, etc.) via publisher-specific adapters, caches results locally, and serves them through programmatic interfaces (library API, CLI, MCP server).

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Start dev server (port 3100, with watch)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled server
npm run typecheck        # Type-check without emitting
npm run crawl            # Run crawler (needs args, see CLI)
```

### CLI

```bash
npx open-legal-codes crawl --jurisdiction ca-mountain-view
npx open-legal-codes list --state CA
```

## Architecture

```
Publisher Adapters → Cache (filesystem) → Consumers (API / CLI / MCP)
```

### Publisher Adapters (`src/crawlers/`)

Each publisher gets its own adapter implementing `CrawlerAdapter` (defined in `src/crawlers/types.ts`):
- `listJurisdictions(state?)` — list available jurisdictions
- `fetchToc(sourceId)` — get table of contents hierarchy
- `fetchSection(sourceId, sectionId)` — get section content (HTML)

**Implemented**: Municode (`municode.ts`) — uses their JSON API at `api.municode.com`
**Stubbed**: American Legal (`amlegal.ts`)

The crawl pipeline (`pipeline.ts`) orchestrates: fetch TOC → transform → fetch all sections → write to cache.

### Cache (`codes/` + `src/store/`)

Filesystem-based. Each jurisdiction gets a directory under `codes/`:
- `_meta.json` — jurisdiction metadata, source info
- `_toc.json` — table of contents tree
- `{path}.html` — original HTML from publisher
- `{path}.xml` — converted XML

`CodeStore` (`src/store/index.ts`) provides read access. `CodeWriter` (`src/store/writer.ts`) handles writes during crawl.

### HTTP API (`src/routes/`)

Hono-based server (`src/server.ts`). Routes are wired to `CodeStore`:
- `GET /api/v1/jurisdictions` — list jurisdictions (filter by type, state, publisher)
- `GET /api/v1/jurisdictions/:id` — single jurisdiction metadata
- `GET /api/v1/jurisdictions/:id/toc` — table of contents (with `?depth=N`)
- `GET /api/v1/jurisdictions/:id/toc/*path` — TOC subtree at a path
- `GET /api/v1/jurisdictions/:id/code/*path` — code content (`?format=text|xml|html`)
- `GET /api/v1/lookup?city=X&state=Y` — find jurisdiction by name

### Converter (`src/converter/`)

HTML-to-XML conversion. Not the current priority — text retrieval matters more than output format.

## Key Design Principles

- **Text retrieval first, fancy formats later.** The priority is getting legal text back reliably. USLM XML, structured JSON, etc. are nice-to-haves.
- **Adapter pattern for publishers.** Each publisher's quirks are isolated in its own adapter. Adding a new publisher means implementing `CrawlerAdapter`.
- **Cache with timestamps, not full versioning.** We cache fetched content and track when it was last retrieved. Git-based version history is not a priority.
- **Architect for CLI/MCP consumption.** The primary consumers will be scripts and AI agents, not browsers. Design the API surface accordingly.
- **US only for now.** Don't over-generalize for international codes yet.
- **Keep it simple.** Avoid over-engineering. The minimum complexity needed for the current task is the right amount.

## Current State

- Municode crawler: **working** — can crawl full municipal codes
- Cache/storage: **working** — reads and writes jurisdiction data
- HTTP API routes: **working** — wired to CodeStore, returns text/xml/html
- American Legal crawler: **stubbed** — interface defined, not implemented
- CLI: **basic** — crawl and list commands work
- MCP server: **not started**
- Search: **not started**
