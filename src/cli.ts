#!/usr/bin/env node

/**
 * Open Legal Codes CLI
 *
 * Usage:
 *   npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view
 *   npx tsx src/cli.ts list --state CA
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Jurisdiction } from './types.js';
import { MunicodeCrawler } from './crawlers/municode.js';
import { runCrawl } from './crawlers/pipeline.js';

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

async function main() {
  switch (command) {
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

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: crawl, list');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
