# Open Legal Codes

Retrieve the text of US legal codes programmatically. Give it a jurisdiction and a code path, get the legislative text back.

## Why

There is no open, machine-readable source of US municipal law. The text is public domain ([Georgia v. Public.Resource.Org, 2020](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.)), but it's locked inside commercial publisher websites (Municode, American Legal) with no API or bulk download.

Open Legal Codes provides a unified interface to retrieve legal codes from these publishers, caches the results locally, and makes them available for programmatic use.

## How It Works

```
Publisher APIs          Cache (filesystem)        Consumers
┌──────────────┐       ┌──────────────────┐      ┌─────────────────┐
│ Municode     │──┐    │ codes/           │      │ Library API     │
│ American Legal│──┼──▶│   {jurisdiction}/ │──▶──│ CLI             │
│ (future...)  │──┘    │     sections...   │      │ MCP Server      │
└──────────────┘       │     _meta.json    │      │ (AI agents)     │
                       │     _toc.json     │      └─────────────────┘
                       └──────────────────┘
```

**Publisher adapters** handle the specifics of retrieving content from each commercial publisher. Results are **cached to the filesystem** with metadata (including when they were last fetched). **Consumers** (a programmatic API, CLI tool, or MCP server) provide different ways to query the cached data.

## Quick Start

```bash
npm install
npm run dev
# Server at http://localhost:3100
```

### Crawl a Jurisdiction

```bash
# Crawl a specific jurisdiction's full code
npx open-legal-codes crawl --jurisdiction ca-mountain-view

# List available jurisdictions in a state
npx open-legal-codes list --state CA
```

### Query a Code

```
GET /api/v1/jurisdictions/ca-mountain-view/code/part-i/article-i/section-100
```

Returns the text of that section.

## Architecture

### Publisher Adapters

Each code publisher needs its own adapter that implements the `CrawlerAdapter` interface:

| Publisher | Status | Coverage |
|-----------|--------|----------|
| **Municode** | Implemented | ~3,200 municipalities |
| **American Legal** | Stubbed | ~2,000 municipalities |

Adapters handle: listing available jurisdictions, fetching table of contents, and fetching section content.

### Cache Layer

Crawled content is stored on the filesystem under `codes/`:

```
codes/
  jurisdictions.json              # Registry of all known jurisdictions
  ca-mountain-view/
    _meta.json                    # Jurisdiction metadata + last fetched timestamp
    _toc.json                     # Table of contents tree
    part-i/
      article-i/
        section-100.html          # Original HTML from publisher
        section-100.xml           # Converted XML
```

The cache lets us serve requests without hitting publisher APIs on every query. Metadata tracks when content was last fetched so consumers know how fresh it is.

### Consumers (Planned)

- **Library API**: Import and call directly from Node.js code
- **CLI**: Command-line tool for scripting and quick lookups
- **MCP Server**: Model Context Protocol server so AI agents can look up legal codes
- **HTTP API**: REST endpoints (current, partially implemented)

## Roadmap

Ordered by priority:

1. **Wire up core query flow** — jurisdiction + code path → text, end to end
2. **More publisher adapters** — American Legal, QCode, CodePublishing, etc.
3. **CLI tool** — `open-legal-codes query ca-mountain-view part-i/article-i/section-100`
4. **MCP server** — AI agents can retrieve legal codes directly
5. **Keyword search** — find sections by searching terms across a jurisdiction's code
6. **Structured formats** — JSON output, potentially USLM XML for consumers that want it

## Tech Stack

- **TypeScript / Node.js** (ES modules)
- **Hono** — HTTP framework
- **Cheerio** — HTML parsing
- **fast-xml-parser** — XML handling

## Legal

The text of the law is public domain. The Supreme Court ruled in [Georgia v. Public.Resource.Org (2020)](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.) that government-authored legal codes cannot be copyrighted.

This project's source code is MIT licensed.

## Status

Early development. Municode adapter works and can crawl full municipal codes. API routes are being wired up.

## Contributing

This project needs help with:

1. **Publisher adapters** — integrations with American Legal, QCode, CodePublishing, Sterling Codifiers, General Code
2. **Improving text extraction** — better handling of edge cases in municipal code HTML
3. **More jurisdictions** — crawl additional cities and submit the data
4. **CLI and MCP server** — building out the consumption layer
