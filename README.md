# Open Legal Codes

**Know what the law actually says.** Open Legal Codes retrieves the current text of US municipal codes from publisher websites, caches them locally, and serves them through a REST API, CLI, and MCP server. No signup, no API key.

Live at [openlegalcodes.org](https://openlegalcodes.org).

## The Problem

US municipal law is public domain ([Georgia v. Public.Resource.Org, 2020](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.)), but there's no open, machine-readable way to access it. The text is locked behind commercial publisher websites (Municode, American Legal, General Code) with no API or bulk download.

If an AI agent tells you "Mountain View prohibits keeping more than 3 dogs," there's no way to verify that against the actual law text — until now.

## Install

### npm

```bash
npm install -g open-legal-codes
```

Or with the TIDY-scoped package:

```bash
npm install -g @tidydotcom/open-legal-codes
```

### Homebrew (macOS/Linux)

```bash
brew install tidyapp/tap/open-legal-codes
```

### From Source

```bash
git clone https://github.com/tidyapp/open-legal-codes.git
cd open-legal-codes
npm install
npm run dev          # API server at http://localhost:3100
```

## Quick Start

```bash
open-legal-codes search --jurisdiction ca-mountain-view --query "dog"
open-legal-codes query --jurisdiction ca-mountain-view --path chapter-5/article-i/section-sec.-5.1
open-legal-codes crawl --jurisdiction ca-mountain-view   # warm the cache
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

After installing via npm or Homebrew, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "legal-codes": {
      "command": "open-legal-codes-mcp"
    }
  }
}
```

Or without installing:

```json
{
  "mcpServers": {
    "legal-codes": {
      "command": "npx",
      "args": ["-y", "-p", "open-legal-codes", "open-legal-codes-mcp"]
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
| `get_case_law` | Find court opinions citing a code section |

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

### What Agents Can Do With This

#### Ground real-world advice in actual law

Today, when you ask an AI "can I build a shed in my backyard?", you get hedge-everything answers: *"You should check with your local building department."* With Open Legal Codes, the agent checks for you:

```
Agent receives: "I want to build a 200 sq ft shed in Mountain View"

1. search_code(jurisdiction: "ca-mountain-view", query: "accessory structure")
   → finds Chapter 36, Zoning Ordinance

2. get_code_text(jurisdiction: "ca-mountain-view", path: "chapter-36/article-ii/...")
   → reads setback requirements, height limits, permit thresholds

3. Agent responds:
   "Mountain View allows accessory structures up to 120 sq ft without a permit,
    but your 200 sq ft shed requires a building permit per Sec. 36.28.15(a).
    Setbacks: 5 ft from side/rear property lines. Max height: 15 ft.
    Full text: https://openlegalcodes.org/ca-mountain-view/chapter-36/..."
```

The agent goes from "check with your city" to citing the exact section, with a link the user can verify themselves.

#### Compare laws across jurisdictions

No human wants to manually read 10 cities' zoning codes to figure out where short-term rentals are allowed. An agent can query all of them in seconds:

```
User: "Which Bay Area cities allow Airbnb?"

Agent calls search_code() across multiple jurisdictions:
  search_code(jurisdiction: "ca-mountain-view", query: "short-term rental")
  search_code(jurisdiction: "ca-san-jose", query: "short-term rental")
  search_code(jurisdiction: "ca-palo-alto", query: "short-term rental")
  ...

Then reads the relevant sections with get_code_text() and compares:

  "Here's what I found:
   - Mountain View: Allowed with a business license, max 180 days/year (Sec. 36.42)
   - San Jose: Allowed, host must be primary resident, max 180 days (Ch. 6.86)
   - Palo Alto: Prohibited in residential zones (Sec. 18.12.030)
   Sources: [links to each section]"
```

This turns days of paralegal research into a single conversation. Useful for real estate investors, businesses expanding to new cities, and policy researchers.

#### Validate agent-generated plans against local law

When agents start generating actionable plans — open a restaurant, renovate a house, launch an event — they can validate each step against the actual code before the user acts on bad advice:

```
User: "Help me plan opening a food truck in Missoula"

Agent generates initial plan, then checks each step:

1. search_code(jurisdiction: "mt-missoula", query: "mobile food vendor")
   → finds Title 8, Business Regulations

2. get_code_text() on each relevant section, then flags issues:

   "Here's your checklist with legal requirements:
    ✓ Business license required (Sec. 8.04.010) — $50/year
    ✓ Mobile food vendor permit required (Sec. 8.60.020)
    ⚠ Cannot operate within 200 ft of a restaurant during lunch hours (Sec. 8.60.040)
    ⚠ Must have written permission from property owner for each location (Sec. 8.60.030)
    ✗ Downtown district has additional restrictions — see Sec. 8.60.050
    Full ordinance: [links]"
```

Instead of a generic plan that misses local requirements, the agent produces one that's grounded in what the law actually says — and flags the gotchas that trip people up.

## Case Law Citations (Beta)

Open Legal Codes answers *"what does the law say?"* — but knowing what the law says is only half the picture. Courts interpret statutes through their opinions, and those interpretations shape what the law actually means in practice. To help connect these two halves, we link each statute to court opinions that have cited it.

**This feature is powered by [CourtListener](https://www.courtlistener.com/), a free and open legal database maintained by the [Free Law Project](https://free.law/).** CourtListener is an extraordinary public resource — they collect, archive, and make searchable millions of court opinions from across the US federal and state court systems. We are deeply grateful for their work.

**We do not store, host, or reproduce case law.** Every citation links directly to the full opinion on CourtListener. We are solely building an automated index that connects our structured statute text to their court opinion database. If you find CourtListener useful, please consider [supporting the Free Law Project](https://free.law/donate/).

**How it works:** For each statute section, we generate [Bluebook citation](https://en.wikipedia.org/wiki/Bluebook) strings (e.g., "42 U.S.C. § 1983", "Cal. Gov. Code § 12965") and search CourtListener for opinions that reference them. Results are displayed in reverse chronological order — most recent opinions first.

**These citations are likely imperfect.** Courts cite statutes inconsistently, and our automated matching will miss relevant opinions and may include tangential results. This works best for federal and state statutes where citation formats are standardized. Municipal codes are not yet supported because there is no standard way courts cite them.

**Nothing here constitutes legal advice or a legal opinion.** This is an automated, best-guess linkage between legal codes and court records. Always consult a qualified attorney for legal matters.

Case law is available via the API (`GET /jurisdictions/:id/caselaw/*path`), CLI (`caselaw` command), MCP (`get_case_law` tool), and the web UI.

Requires a free CourtListener API token (`COURTLISTENER_API_TOKEN` environment variable). Get one at [courtlistener.com](https://www.courtlistener.com/sign-in/).

## REST API

Base URL: `https://openlegalcodes.org/api/v1`

| Endpoint | Description |
|----------|-------------|
| `GET /jurisdictions` | List jurisdictions (filter: `?state=CA&publisher=municode`) |
| `GET /jurisdictions/:id` | Jurisdiction metadata |
| `GET /jurisdictions/:id/toc` | Table of contents (`?depth=2`) |
| `GET /jurisdictions/:id/toc/*path` | TOC subtree at a path |
| `GET /jurisdictions/:id/code/*path` | Code text (`?format=text\|xml\|html`) |
| `GET /jurisdictions/:id/caselaw/*path` | Citing court opinions (`?limit=20&offset=0`) |
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
open-legal-codes query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
open-legal-codes toc --jurisdiction ca-mountain-view --depth 2
open-legal-codes search --jurisdiction ca-mountain-view --query "rental"
open-legal-codes caselaw --jurisdiction ca-gov --path title-2/.../section-12965
open-legal-codes crawl --jurisdiction ca-mountain-view
open-legal-codes list --state CA
```

## Architecture

```
Publisher APIs          SQLite                    Consumers
┌──────────────┐       ┌──────────────────┐      ┌─────────────────┐
│ Municode     │──┐    │ openlegalcodes.db│      │ REST API        │
│ American Legal│──┼──▶│   jurisdictions  │──▶──│ CLI             │
│ eCFR, etc.   │──┘    │   toc_nodes      │      │ MCP Server      │
└──────────────┘       │   sections (FTS5)│      │ Web UI          │
                       └──────┬───────────┘      └─────────────────┘
                              │
CourtListener API ──▶ caselaw_results
```

- **Publisher adapters** (`src/crawlers/`) handle each publisher's quirks
- **SQLite** stores all data — jurisdictions, TOC trees, code content, and case law citations
- **FTS5** provides full-text search (no in-memory index needed)
- **Case law** links to CourtListener — we don't store or host opinions
- **CDN-ready** — static code sections are cacheable; only `/search` and `/lookup` need origin

### Publisher Coverage

| Publisher | Status | Coverage |
|-----------|--------|----------|
| **Municode** | Working | ~4,200 cities + counties |
| **American Legal** | Working | ~3,500 municipalities |
| **eCode360 (General Code)** | Working | ~4,400 cities + counties |
| **eCFR** | Working | All 49 CFR titles (federal) |
| **CA Leginfo** | Working | All 30 California state codes |
| **NY Open Legislation** | Working | All New York state laws |

37,000+ jurisdictions across municipal, county, state, and federal levels.

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
Client → CDN (Cloudflare) → Origin (Node.js + Hono) → SQLite (data/openlegalcodes.db)
```

- Static code sections are CDN-cacheable with long TTLs
- Only `/search`, `/lookup`, and `/caselaw` hit origin
- SQLite with WAL mode for concurrent reads
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

**Case law citations are best-effort and do not constitute legal advice.** We link to court opinions on CourtListener using automated citation matching. These links may be incomplete, imprecise, or miss relevant cases entirely. Nothing provided by this service should be interpreted as a legal opinion. Always consult a qualified attorney.

This project's source code is MIT licensed.

## Acknowledgments

Case law citations are made possible by **[CourtListener](https://www.courtlistener.com/)** and the **[Free Law Project](https://free.law/)**. CourtListener provides free, open access to millions of court opinions from federal and state courts across the United States. We search their database to find opinions that cite specific statutes and link directly to their records — we do not host, reproduce, or redistribute any court opinions.

The Free Law Project is a 501(c)(3) non-profit that believes legal information should be free and accessible to everyone. Their work makes projects like this possible. If you benefit from the case law features in Open Legal Codes, please consider [supporting the Free Law Project](https://free.law/donate/).

## Sponsor

Open Legal Codes is offered free of charge by [TIDY](https://tidy.com), an AI property management company.
