#!/usr/bin/env node

// Open Legal Codes CLI

import { ApiClient, isCrawling } from './api-client.js';
import type { TocNode } from './api-client.js';

const USAGE = `Open Legal Codes CLI

Commands:
  query   --jurisdiction <id> --path <code-path>   Get the text of a code section
  toc     --jurisdiction <id> [--depth N]           Browse table of contents
  search  --jurisdiction <id> --query <terms>       Search code text
  caselaw --jurisdiction <id> --path <code-path>   Find citing court opinions
  list    [--state XX] [--type TYPE]                List available jurisdictions
  lookup  --city <name> --state <XX>                Find jurisdiction by name

Examples:
  open-legal-codes query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
  open-legal-codes toc --jurisdiction ca-mountain-view --depth 2
  open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
  open-legal-codes caselaw --jurisdiction ca-pen --path part-1/title-8/section-187
  open-legal-codes list --state CA
  open-legal-codes lookup --city "Mountain View" --state CA

A free service by TIDY — AI Property Manager (tidy.com)
`;

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value !== undefined && !value.startsWith('--')) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else if (arg === '-h') {
      flags['help'] = 'true';
    }
  }

  return { command, flags };
}

function formatTocNodes(nodes: TocNode[], depth: number = 0, maxDepth: number = 3): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const content = node.hasContent ? ' [has content]' : '';
    const heading = node.heading ? ` — ${node.heading}` : '';
    lines.push(`${indent}${node.path}: ${node.num}${heading}${content}`);
    if (node.children && depth < maxDepth - 1) {
      lines.push(formatTocNodes(node.children, depth + 1, maxDepth));
    }
  }
  return lines.join('\n');
}

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (command === 'help' || command === '--help' || command === '-h' || flags['help']) {
    console.log(USAGE);
    return;
  }

  const client = new ApiClient();

  try {
    switch (command) {
      case 'query': {
        const jurisdiction = flags['jurisdiction'];
        const path = flags['path'];
        if (!jurisdiction || !path) {
          console.error('Error: --jurisdiction and --path are required');
          console.log('\nUsage: open-legal-codes query --jurisdiction <id> --path <code-path>');
          process.exit(1);
        }
        const result = await client.getCodeText(jurisdiction, path);
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        console.log(`${result.jurisdictionName}`);
        console.log(`${result.num} ${result.heading}`);
        console.log('─'.repeat(60));
        console.log(result.text);
        console.log('─'.repeat(60));
        console.log(`Source: ${result.url}`);
        break;
      }

      case 'toc': {
        const jurisdiction = flags['jurisdiction'];
        if (!jurisdiction) {
          console.error('Error: --jurisdiction is required');
          console.log('\nUsage: open-legal-codes toc --jurisdiction <id> [--depth N]');
          process.exit(1);
        }
        const depth = flags['depth'] ? parseInt(flags['depth'], 10) : 3;
        const result = await client.getToc(jurisdiction, { depth });
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        console.log(`${result.title}\n`);
        console.log(formatTocNodes(result.children, 0, depth));
        break;
      }

      case 'search': {
        const jurisdiction = flags['jurisdiction'];
        const query = flags['query'];
        if (!jurisdiction || !query) {
          console.error('Error: --jurisdiction and --query are required');
          console.log('\nUsage: open-legal-codes search --jurisdiction <id> --query <terms>');
          process.exit(1);
        }
        const limit = flags['limit'] ? parseInt(flags['limit'], 10) : undefined;
        const result = await client.search(jurisdiction, query, { limit });
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        if (result.length === 0) {
          console.log(`No results found for "${query}" in ${jurisdiction}.`);
          return;
        }
        console.log(`Search results for "${query}" in ${jurisdiction}:`);
        console.log('─'.repeat(60));
        for (const r of result) {
          console.log(`${r.path}`);
          console.log(`  ${r.num} ${r.heading}`);
          console.log(`  ${r.snippet}`);
          console.log(`  ${r.url}`);
          console.log();
        }
        break;
      }

      case 'list': {
        const result = await client.listJurisdictions({
          state: flags['state'],
          type: flags['type'],
        });
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        if (result.length === 0) {
          console.log('No jurisdictions found.');
          return;
        }
        for (const j of result) {
          console.log(`${j.id}\t${j.name}`);
        }
        break;
      }

      case 'caselaw': {
        const jurisdiction = flags['jurisdiction'];
        const path = flags['path'];
        if (!jurisdiction || !path) {
          console.error('Error: --jurisdiction and --path are required');
          console.log('\nUsage: open-legal-codes caselaw --jurisdiction <id> --path <code-path> [--limit N]');
          process.exit(1);
        }
        const limit = flags['limit'] ? parseInt(flags['limit'], 10) : 20;
        const result = await client.getCaseLaw(jurisdiction, path, { limit });
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        if (!result.supported) {
          console.log(result.note || 'Case law lookup is not supported for this jurisdiction type.');
          return;
        }
        if (result.jurisdictionName) {
          console.log(result.jurisdictionName);
        }
        if (result.num) {
          console.log(`${result.num}${result.heading ? ' — ' + result.heading : ''}`);
        }
        if (result.citationQueries.length > 0) {
          console.log(`Searching for: ${result.citationQueries.join(', ')}`);
        }
        console.log('─'.repeat(60));
        if (result.cases.length === 0) {
          console.log('No citing opinions found.');
        } else {
          for (let i = 0; i < result.cases.length; i++) {
            const c = result.cases[i];
            console.log(`${i + 1}. ${c.caseName} (${c.court}, ${c.dateFiled})`);
            if (c.citation) console.log(`   ${c.citation}${c.citeCount ? ` — cited by ${c.citeCount} opinions` : ''}`);
            console.log(`   ${c.url}`);
            if (c.snippet) console.log(`   ${c.snippet}`);
            console.log();
          }
          console.log(`Showing ${result.cases.length} of ${result.totalCount} results.`);
        }
        break;
      }

      case 'lookup': {
        const city = flags['city'];
        const state = flags['state'];
        if (!city && !state) {
          console.error('Error: --city and/or --state are required');
          console.log('\nUsage: open-legal-codes lookup --city <name> --state <XX>');
          process.exit(1);
        }
        const result = await client.lookup({ city, state, slug: flags['slug'] });
        if (isCrawling(result)) {
          console.log('This jurisdiction is being loaded. Try again in ~30 seconds.');
          return;
        }
        const jurisdictions = Array.isArray(result) ? result : [result];
        if (jurisdictions.length === 0) {
          console.log('No jurisdictions found.');
          return;
        }
        for (const j of jurisdictions) {
          console.log(`${j.id}\t${j.name}\t${j.type}\t${j.state || ''}\t${j.publisher?.name || ''}`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
