---
name: query-code
description: Look up the text of a specific legal code section by jurisdiction and path. Use when the user wants to read the actual text of a law.
argument-hint: [jurisdiction] [path]
user-invocable: true
---

# Query Legal Code

Look up a specific section of municipal code.

1. Run: `npx tsx src/cli.ts query --jurisdiction $0 --path $1`
2. Display the returned text to the user
3. Include the direct link: `https://openlegalcodes.org/$0/$1`
4. Offer to search for related sections if needed
