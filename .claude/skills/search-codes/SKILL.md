---
name: search-codes
description: Search for keywords in a jurisdiction's legal code. Use when looking for what the law says about a topic.
argument-hint: [jurisdiction] [query]
user-invocable: true
---

# Search Legal Codes

Search for exact keyword matches within a jurisdiction's municipal code.

1. Run: `npx tsx src/cli.ts search --jurisdiction $0 --query "$1"`
2. Display the matching sections with their paths
3. For each result, include the direct link: `https://openlegalcodes.org/$0/{path}`
4. Offer to retrieve the full text of any matching section with `/query-code`
