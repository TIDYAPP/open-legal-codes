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
import { getCrawler, PUBLISHERS } from './crawlers/index.js';
import { crawlQueue } from './crawl-queue.js';
import { CodeStore } from './store/index.js';
import { buildCatalog } from './registry/catalog-builder.js';
import { loadCensusData } from './registry/census-loader.js';
import { matchRegistryToCensus } from './registry/matcher.js';

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
  list    [--state XX] [--publisher NAME]           List available jurisdictions
  catalog [--publisher NAME] [--state XX]           Scan publishers to build registry
  census                                            Download Census Bureau geographic data
  match                                             Cross-reference registry with Census data

Publishers: ${PUBLISHERS.join(', ')}

Examples:
  open-legal-codes query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
  open-legal-codes toc --jurisdiction ca-mountain-view --depth 2
  open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
  open-legal-codes crawl --jurisdiction us-cfr-title-24
  open-legal-codes list --state CA
  open-legal-codes list --publisher ecfr`);
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

      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      console.log(`Searching "${query}" in ${jurisdictionId}...\n`);
      const results = store.search(jurisdictionId, query);

      for (const r of results) {
        console.log(`  ${r.path}`);
        console.log(`    ${r.num}${r.heading ? ' — ' + r.heading : ''}`);
        console.log(`    ${r.snippet}\n`);
      }
      console.log(`${results.length} sections found.`);
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

      console.log(`Crawling ${jurisdiction.name} (${jurisdiction.publisher.name}, sourceId: ${jurisdiction.publisher.sourceId})`);

      const crawler = getCrawler(jurisdiction.publisher.name);
      const progress = await crawlQueue.enqueue(crawler, { jurisdiction }, (p) => {
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
      const publisher = getArg('publisher') || 'municode';

      const crawler = getCrawler(publisher);
      console.log(`Listing ${publisher} jurisdictions${state ? ` in ${state}` : ''}...`);
      let count = 0;
      for await (const j of crawler.listJurisdictions(state)) {
        console.log(`${j.id}\t${j.name}\t${j.publisher.sourceId}`);
        count++;
      }
      console.log(`\n${count} jurisdictions found.`);
      break;
    }

    case 'catalog': {
      const publisher = getArg('publisher');
      const state = getArg('state');
      console.log('Building jurisdiction registry...');
      const entries = await buildCatalog({
        publisher: publisher || undefined,
        state: state || undefined,
        onProgress: (msg) => console.log(msg),
      });
      console.log(`\nRegistry complete: ${entries.length} jurisdictions`);
      const byPublisher: Record<string, number> = {};
      for (const e of entries) {
        byPublisher[e.publisher] = (byPublisher[e.publisher] || 0) + 1;
      }
      for (const [pub, count] of Object.entries(byPublisher)) {
        console.log(`  ${pub}: ${count}`);
      }
      break;
    }

    case 'census': {
      console.log('Downloading Census Bureau gazetteer data...');
      const places = await loadCensusData({
        onProgress: (msg) => console.log(msg),
      });
      console.log(`\nCensus data loaded: ${places.length} places`);
      const byType: Record<string, number> = {};
      for (const p of places) {
        byType[p.type] = (byType[p.type] || 0) + 1;
      }
      for (const [type, count] of Object.entries(byType)) {
        console.log(`  ${type}: ${count}`);
      }
      break;
    }

    case 'match': {
      console.log('Cross-referencing registry with Census data...');
      const result = await matchRegistryToCensus({
        onProgress: (msg) => console.log(msg),
      });
      console.log(`\nMatching complete: ${result.matched}/${result.total} matched (${Math.round(result.matched / result.total * 100)}%)`);
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
