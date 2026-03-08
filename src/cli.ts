#!/usr/bin/env node

/**
 * Open Legal Codes CLI
 *
 * Usage:
 *   npx tsx src/cli.ts query  --jurisdiction ca-mountain-view --path part-i/article-i/section-100
 *   npx tsx src/cli.ts toc    --jurisdiction ca-mountain-view [--depth 2]
 *   npx tsx src/cli.ts search --jurisdiction ca-mountain-view --query "zoning"
 *   npx tsx src/cli.ts crawl  --jurisdiction ca-mountain-view
 *   npx tsx src/cli.ts list   --state CA
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Jurisdiction, TocNode } from './types.js';
import { MunicodeCrawler } from './crawlers/municode.js';
import { runCrawl } from './crawlers/pipeline.js';
import { CodeStore } from './store/index.js';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function loadJurisdiction(id: string): Jurisdiction | null {
  const registryPath = join(process.cwd(), 'codes', 'jurisdictions.json');
  if (!existsSync(registryPath)) return null;
  const jurisdictions: Jurisdiction[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
  return jurisdictions.find(j => j.id === id) ?? null;
}

function printUsage() {
  console.log(`Open Legal Codes CLI

Commands:
  query   --jurisdiction <id> --path <code-path>   Get the text of a code section
  toc     --jurisdiction <id> [--depth N]           Browse table of contents
  search  --jurisdiction <id> --query <terms>       Search code text
  crawl   --jurisdiction <id>                       Crawl a jurisdiction from publisher
  list    [--state XX]                              List available jurisdictions

Examples:
  open-legal-codes query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
  open-legal-codes toc --jurisdiction ca-mountain-view --depth 2
  open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
  open-legal-codes list --state CA`);
}

async function main() {
  switch (command) {
    case 'query': {
      const jurisdictionId = getArg('jurisdiction');
      const codePath = getArg('path');
      if (!jurisdictionId || !codePath) {
        console.error('Usage: open-legal-codes query --jurisdiction <id> --path <code-path>');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const text = store.getCodeText(jurisdictionId, codePath);
      if (!text) {
        console.error(`Code path "${codePath}" not found in "${jurisdictionId}".`);
        console.error('Use "toc" command to browse available sections.');
        process.exit(1);
      }

      const tocNode = store.getTocNode(jurisdictionId, codePath);
      if (tocNode) {
        console.log(`${jurisdiction.name}`);
        console.log(`${tocNode.num}${tocNode.heading ? ' — ' + tocNode.heading : ''}`);
        console.log('---');
      }
      console.log(text);
      break;
    }

    case 'toc': {
      const jurisdictionId = getArg('jurisdiction');
      if (!jurisdictionId) {
        console.error('Usage: open-legal-codes toc --jurisdiction <id> [--depth N]');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const toc = store.getToc(jurisdictionId);
      if (!toc) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const maxDepth = getArg('depth') ? parseInt(getArg('depth')!, 10) : 3;
      console.log(`${toc.title}\n`);
      printTocNodes(toc.children, 0, maxDepth);
      break;
    }

    case 'search': {
      const jurisdictionId = getArg('jurisdiction');
      const query = getArg('query');
      if (!jurisdictionId || !query) {
        console.error('Usage: open-legal-codes search --jurisdiction <id> --query <terms>');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const toc = store.getToc(jurisdictionId);
      if (!toc) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const queryLower = query.toLowerCase();
      const queryLen = query.length;
      let count = 0;

      function searchNodes(nodes: TocNode[]) {
        for (const node of nodes) {
          if (node.hasContent) {
            const text = store.getCodeText(jurisdictionId!, node.path);
            if (text && text.toLowerCase().includes(queryLower)) {
              count++;
              const idx = text.toLowerCase().indexOf(queryLower);
              const start = Math.max(0, idx - 40);
              const end = Math.min(text.length, idx + queryLen + 40);
              const snippet = (start > 0 ? '...' : '') +
                text.slice(start, end) +
                (end < text.length ? '...' : '');
              console.log(`  ${node.path}`);
              console.log(`    ${node.num}${node.heading ? ' — ' + node.heading : ''}`);
              console.log(`    ${snippet}\n`);
            }
          }
          if (node.children) searchNodes(node.children);
        }
      }

      console.log(`Searching "${query}" in ${jurisdictionId}...\n`);
      searchNodes(toc.children);
      console.log(`${count} sections found.`);
      break;
    }

    case 'crawl': {
      const jurisdictionId = getArg('jurisdiction');
      if (!jurisdictionId) {
        console.error('Usage: open-legal-codes crawl --jurisdiction <id>');
        console.error('Example: open-legal-codes crawl --jurisdiction ca-mountain-view');
        process.exit(1);
      }

      const jurisdiction = loadJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found in codes/jurisdictions.json`);
        process.exit(1);
      }

      if (jurisdiction.publisher.name !== 'municode') {
        console.error(`Only Municode is supported. "${jurisdictionId}" uses ${jurisdiction.publisher.name}`);
        process.exit(1);
      }

      console.log(`Crawling ${jurisdiction.name} (sourceId: ${jurisdiction.publisher.sourceId})`);

      const crawler = new MunicodeCrawler();
      const progress = await runCrawl(crawler, { jurisdiction }, (p) => {
        if (p.phase === 'sections' && p.total > 0) {
          const pct = Math.round((p.completed / p.total) * 100);
          process.stdout.write(
            `\r[${p.phase}] ${p.completed}/${p.total} (${pct}%) ${p.currentPath || ''}`.padEnd(80),
          );
        }
      });

      console.log('');
      if (progress.errors.length > 0) {
        console.log(`\n${progress.errors.length} errors:`);
        for (const e of progress.errors) {
          console.error(`  FAIL: ${e.path}: ${e.error}`);
        }
      }
      break;
    }

    case 'list': {
      const state = getArg('state');
      const crawler = new MunicodeCrawler();

      console.log(`Listing Municode jurisdictions${state ? ` in ${state}` : ''}...`);
      let count = 0;
      for await (const j of crawler.listJurisdictions(state)) {
        console.log(`${j.id}\t${j.name}\t${j.publisher.sourceId}`);
        count++;
      }
      console.log(`\n${count} jurisdictions found.`);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printTocNodes(nodes: TocNode[], depth: number, maxDepth: number) {
  for (const node of nodes) {
    const indent = '  '.repeat(depth);
    const content = node.hasContent ? ' *' : '';
    const heading = node.heading ? ` — ${node.heading}` : '';
    console.log(`${indent}${node.path}: ${node.num}${heading}${content}`);
    if (node.children && depth < maxDepth - 1) {
      printTocNodes(node.children, depth + 1, maxDepth);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
