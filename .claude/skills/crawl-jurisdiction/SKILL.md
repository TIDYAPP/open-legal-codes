---
name: crawl-jurisdiction
description: Crawl and cache a jurisdiction's legal code from its publisher. Use to warm the cache for a new jurisdiction.
argument-hint: [jurisdiction]
user-invocable: true
---

# Crawl Jurisdiction

Crawl a jurisdiction's municipal code from its publisher and cache it locally.

1. First, check if the jurisdiction exists: `npx tsx src/cli.ts list --state` (use appropriate state)
2. Run: `npx tsx src/cli.ts crawl --jurisdiction $0`
3. This may take up to a minute for a full code. Wait for it to complete.
4. Confirm when done and suggest next steps (search, browse TOC, query sections)
