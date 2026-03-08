# Open Legal Codes

Open source repository of US legal codes in [USLM XML](https://github.com/usgpo/uslm) format, served via REST API.

This is **not a search engine**. It's a structured code repository. You navigate the hierarchy (jurisdiction > title > chapter > section) and get the actual legislative text back. Think: npm registry for law.

## Why

There is no open, machine-readable source of US municipal law. The text is public domain ([Georgia v. Public.Resource.Org, 2020](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.)), but it's locked inside commercial publisher websites (Municode, American Legal) with no API or bulk download.

Open Legal Codes crawls these publishers, converts the content to the official [USLM XML](https://github.com/usgpo/uslm) standard, stores it in git (for version history), and serves it via a simple REST API.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3100
```

## API

Base URL: `/api/v1`

### Jurisdictions

```
GET /api/v1/jurisdictions                     # List all
GET /api/v1/jurisdictions?type=city&state=CA   # Filter by type and state
GET /api/v1/jurisdictions/ca-palm-desert       # Single jurisdiction
```

### Table of Contents

```
GET /api/v1/jurisdictions/ca-palm-desert/toc             # Full TOC tree
GET /api/v1/jurisdictions/ca-palm-desert/toc?depth=1     # Top-level only
GET /api/v1/jurisdictions/ca-palm-desert/toc/title-5     # Subtree
```

### Code Content

```
GET /api/v1/jurisdictions/ca-palm-desert/code/title-5
GET /api/v1/jurisdictions/ca-palm-desert/code/title-5/chapter-5.10
GET /api/v1/jurisdictions/ca-palm-desert/code/title-5/chapter-5.10/section-5.10.010
GET /api/v1/jurisdictions/ca-palm-desert/code/title-5/chapter-5.10/section-5.10.010?format=json
```

Default format is USLM XML. Add `?format=json` for JSON output.

Add `?version=<sha>` for point-in-time access (git commit SHA).

### Lookup

```
GET /api/v1/lookup?city=Palm+Desert&state=CA
```

### Versions

```
GET /api/v1/jurisdictions/ca-palm-desert/versions?limit=20
```

## Data Format

Codes are stored as USLM XML, the official US Government Publishing Office standard for legislative markup. Each section is a single XML file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<lawDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"
        identifier="/ca-palm-desert/title-5/chapter-5.10/section-5.10.010">
  <meta>
    <dc:title>Palm Desert Municipal Code - Section 5.10.010</dc:title>
    <dc:publisher>City of Palm Desert</dc:publisher>
  </meta>
  <main>
    <section identifier="/ca-palm-desert/title-5/chapter-5.10/section-5.10.010"
             temporalId="s5_10_010">
      <num>5.10.010</num>
      <heading>Purpose.</heading>
      <content>
        <p>The purpose of this chapter is to establish regulations for
        short-term rental properties within the City of Palm Desert...</p>
      </content>
    </section>
  </main>
</lawDoc>
```

## Storage Layout

```
codes/
  jurisdictions.json              # Global registry
  ca-palm-desert/
    _meta.json                    # Jurisdiction metadata
    _toc.json                     # Table of contents tree
    title-5/
      chapter-5.10/
        section-5.10.010.xml      # One file per section
        section-5.10.020.xml
```

One XML file per section. Git diffs show exactly what changed in the law.

## Crawlers

Currently supports two publishers:

| Publisher | Method | Coverage |
|-----------|--------|----------|
| **Municode** | JSON API (`api.municode.com`) | ~3,200 municipalities |
| **American Legal** | Playwright (Angular SPA) | ~2,000 municipalities |

```bash
# Crawl a specific jurisdiction
npx open-legal-codes crawl --jurisdiction ca-palm-desert

# List available jurisdictions in a state
npx open-legal-codes list --state CA
```

## Tech Stack

- **TypeScript / Node.js**
- **Hono** — minimal HTTP framework
- **Cheerio** — HTML parsing for Municode
- **Playwright** — browser automation for American Legal
- **fast-xml-parser** — XML to JSON conversion
- **Git** — version control for code changes (no database)

## Legal

The text of the law is public domain. The Supreme Court ruled in [Georgia v. Public.Resource.Org (2020)](https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc.) that government-authored legal codes, including annotations, cannot be copyrighted.

This project's source code is MIT licensed.

## Status

Early development. MVP target: serve Palm Desert, CA municipal code via the API.

## Contributing

This project needs help with:

1. **Crawler adapters** for additional publishers (QCode, CodePublishing, Sterling Codifiers, General Code)
2. **HTML to USLM converter** improvements for edge cases in municipal code formatting
3. **More jurisdictions** — run crawlers against new cities and submit the data
4. **Federal and state codes** — integrate with existing government XML sources (GPO for federal, state legislature sites)
