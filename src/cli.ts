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
import { getCaseLaw } from './caselaw/index.js';
import { CodeWriter, stripHtml } from './store/writer.js';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function loadJurisdiction(id: string): Jurisdiction | null {
  // Check cached jurisdictions first
  const registryPath = join(process.cwd(), 'codes', 'jurisdictions.json');
  if (existsSync(registryPath)) {
    const jurisdictions: Jurisdiction[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const found = jurisdictions.find(j => j.id === id);
    if (found) return found;
  }

  // Fall back to manual sources (for HOAs and other manually-configured jurisdictions)
  const manualPath = join(process.cwd(), 'data', 'manual-sources.json');
  if (existsSync(manualPath)) {
    const sources = JSON.parse(readFileSync(manualPath, 'utf-8')) as Array<{
      id: string; name: string; type: string; state: string | null;
      parentId: string | null; sourceUrl: string;
    }>;
    const source = sources.find(s => s.id === id);
    if (source) {
      return {
        id: source.id,
        name: source.name,
        type: source.type as Jurisdiction['type'],
        state: source.state,
        parentId: source.parentId,
        fips: null,
        publisher: {
          name: 'manual' as const,
          sourceId: source.id,
          url: source.sourceUrl,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  return null;
}

function printUsage() {
  console.log(`Open Legal Codes CLI

Commands:
  query   --jurisdiction <id> [--code <codeId>] --path <code-path>   Get the text of a code section
  toc     --jurisdiction <id> [--code <codeId>] [--depth N]           Browse table of contents
  codes   --jurisdiction <id>                                         List available codes
  search  --jurisdiction <id> [--code <codeId>] --query <terms>       Search code text
  caselaw --jurisdiction <id> [--code <codeId>] --path <code-path>   Find citing court opinions
  report  --jurisdiction <id> [--code <codeId>] --path <path> --type <type> [--description "..."]
                                                    Report a bad result (types: bad_citation, out_of_date, wrong_text, other)
  crawl   --jurisdiction <id> [--code <codeId>]     Crawl a jurisdiction from publisher (omit --code to crawl all)
  list    [--state XX] [--publisher NAME]           List available jurisdictions
  catalog [--publisher NAME] [--state XX]           Scan publishers to build registry
  census                                            Download Census Bureau geographic data
  match                                             Cross-reference registry with Census data
  logs    [recent|stats|errors] [--jurisdiction ID] [--since YYYY-MM-DD] [--limit N]

Publishers: ${PUBLISHERS.join(', ')}

Examples:
  open-legal-codes query --jurisdiction ca-mountain-view --path part-i/article-i/section-100
  open-legal-codes toc --jurisdiction ca-mountain-view --depth 2
  open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
  open-legal-codes crawl --jurisdiction us-cfr-title-24
  open-legal-codes list --state CA
  open-legal-codes list --publisher ecfr

A free service by TIDY — AI Property Manager (tidy.com)`);
}

async function main() {
  switch (command) {
    case 'query': {
      const jurisdictionId = getArg('jurisdiction');
      const codePath = getArg('path');
      const codeId = getArg('code');
      if (!jurisdictionId || !codePath) {
        console.error('Usage: open-legal-codes query --jurisdiction <id> [--code <codeId>] --path <code-path>');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const text = store.getCodeText(jurisdictionId, codePath, codeId);
      if (!text) {
        console.error(`Code path "${codePath}" not found in "${jurisdictionId}".`);
        console.error('Use "toc" command to browse available sections.');
        process.exit(1);
      }

      const tocNode = store.getTocNode(jurisdictionId, codePath, codeId);
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
      const codeId = getArg('code');
      if (!jurisdictionId) {
        console.error('Usage: open-legal-codes toc --jurisdiction <id> [--code <codeId>] [--depth N]');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const toc = store.getToc(jurisdictionId, codeId);
      if (!toc) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const maxDepth = getArg('depth') ? parseInt(getArg('depth')!, 10) : 3;
      console.log(`${toc.title}\n`);
      printTocNodes(toc.children, 0, maxDepth);
      break;
    }

    case 'codes': {
      const jurisdictionId = getArg('jurisdiction');
      if (!jurisdictionId) {
        console.error('Usage: open-legal-codes codes --jurisdiction <id>');
        process.exit(1);
      }

      const store = new CodeStore();
      store.initialize();

      const codes = store.listCodes(jurisdictionId);
      if (codes.length === 0) {
        console.error(`No codes found for "${jurisdictionId}". The jurisdiction may not have been crawled yet.`);
        process.exit(1);
      }

      console.log(`Codes for ${jurisdictionId}:\n`);
      for (const code of codes) {
        const primary = code.isPrimary ? ' [primary]' : '';
        console.log(`  ${code.codeId} — ${code.name}${primary}`);
      }
      console.log(`\n${codes.length} code(s) found.`);
      break;
    }

    case 'search': {
      const jurisdictionId = getArg('jurisdiction');
      const query = getArg('query');
      const codeId = getArg('code');
      if (!jurisdictionId || !query) {
        console.error('Usage: open-legal-codes search --jurisdiction <id> [--code <codeId>] --query <terms>');
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
      const results = store.search(jurisdictionId, query, undefined, codeId);

      for (const r of results) {
        console.log(`  ${r.path}`);
        console.log(`    ${r.num}${r.heading ? ' — ' + r.heading : ''}`);
        console.log(`    ${r.snippet}\n`);
      }
      console.log(`${results.length} sections found.`);
      break;
    }

    case 'caselaw': {
      const jurisdictionId = getArg('jurisdiction');
      const codePath = getArg('path');
      const codeId = getArg('code');
      if (!jurisdictionId || !codePath) {
        console.error('Usage: open-legal-codes caselaw --jurisdiction <id> [--code <codeId>] --path <code-path> [--limit N]');
        process.exit(1);
      }

      const store = new CodeStore();

      const jurisdiction = store.getJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found.`);
        process.exit(1);
      }

      const tocNode = store.getTocNode(jurisdictionId, codePath, codeId);
      const limit = getArg('limit') ? parseInt(getArg('limit')!, 10) : 20;

      try {
        const result = await getCaseLaw(jurisdiction, codePath, tocNode || undefined, { limit });

        if (!result.supported) {
          console.log('Case law lookup is not yet available for this jurisdiction type (municipal codes lack standardized citation formats).');
          break;
        }

        if (tocNode) {
          console.log(`${jurisdiction.name}`);
          console.log(`${tocNode.num}${tocNode.heading ? ' — ' + tocNode.heading : ''}`);
        }
        console.log(`Searching CourtListener for: ${result.queries.map(q => q.label).join(', ')}`);
        console.log('---');

        if (result.results.length === 0) {
          console.log('No citing opinions found.');
        } else {
          for (let i = 0; i < result.results.length; i++) {
            const r = result.results[i];
            console.log(`${i + 1}. ${r.caseName} (${r.court}, ${r.dateFiled})`);
            if (r.citation) console.log(`   ${r.citation}${r.citeCount ? ` — cited by ${r.citeCount} opinions` : ''}`);
            console.log(`   ${r.url}`);
            if (r.snippet) console.log(`   ${stripHtml(r.snippet)}`);
            console.log('');
          }
          console.log(`Showing ${result.results.length} of ${result.totalCount} results.`);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'report': {
      const jurisdictionId = getArg('jurisdiction');
      const codePath = getArg('path');
      const reportType = getArg('type');
      const description = getArg('description') || '';
      const codeId = getArg('code');

      if (!jurisdictionId || !codePath || !reportType) {
        console.error('Usage: open-legal-codes report --jurisdiction <id> [--code <codeId>] --path <path> --type <type> [--description "..."]');
        console.error('Types: bad_citation, out_of_date, wrong_text, other');
        process.exit(1);
      }

      const validTypes = ['bad_citation', 'out_of_date', 'wrong_text', 'other'];
      if (!validTypes.includes(reportType)) {
        console.error(`Invalid type "${reportType}". Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      const writer = new CodeWriter();
      const feedbackId = writer.createFeedback({
        jurisdictionId,
        path: codePath,
        reportType,
        description,
        codeId: codeId || undefined,
      });

      console.log(`Report #${feedbackId} submitted. Thank you for the feedback.`);
      break;
    }

    case 'crawl': {
      const jurisdictionId = getArg('jurisdiction');
      const codeId = getArg('code');
      if (!jurisdictionId) {
        console.error('Usage: open-legal-codes crawl --jurisdiction <id> [--code <codeId>]');
        console.error('Example: open-legal-codes crawl --jurisdiction ca-mountain-view');
        process.exit(1);
      }

      const jurisdiction = loadJurisdiction(jurisdictionId);
      if (!jurisdiction) {
        console.error(`Jurisdiction "${jurisdictionId}" not found in codes/jurisdictions.json`);
        process.exit(1);
      }

      console.log(`Crawling ${jurisdiction.name} (${jurisdiction.publisher.name}, sourceId: ${jurisdiction.publisher.sourceId})${codeId ? ` [code: ${codeId}]` : ''}`);

      const crawler = getCrawler(jurisdiction.publisher.name);
      const progress = await crawlQueue.enqueue(crawler, { jurisdiction, codeId }, (p) => {
        if (p.phase === 'sections' && p.total > 0) {
          const pct = Math.round((p.completed / p.total) * 100);
          const codeLabel = p.currentCode ? `[${p.currentCode}] ` : '';
          process.stdout.write(
            `\r${codeLabel}[${p.phase}] ${p.completed}/${p.total} (${pct}%) ${p.currentPath || ''}`.padEnd(80),
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
      const codesDir = join(process.cwd(), 'codes');

      const crawler = getCrawler(publisher);
      console.log(`Listing ${publisher} jurisdictions${state ? ` in ${state}` : ''}...`);
      let count = 0;
      let cachedCount = 0;
      for await (const j of crawler.listJurisdictions(state)) {
        const isCached = existsSync(join(codesDir, j.id, '_toc.json'));
        const status = isCached ? '[cached]' : '[available]';
        if (isCached) cachedCount++;
        console.log(`${status}\t${j.id}\t${j.name}\t${j.publisher.sourceId}`);
        count++;
      }
      console.log(`\n${count} jurisdictions found (${cachedCount} cached).`);
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

    case 'logs': {
      const { requestLog } = await import('./request-log.js');
      const sub = args[1];
      const jurisdiction = getArg('jurisdiction');
      const since = getArg('since') || undefined;
      const limit = getArg('limit') ? parseInt(getArg('limit')!, 10) : 20;

      if (sub === 'stats') {
        const s = await requestLog.stats(since);
        console.log(`Request Stats${since ? ` (since ${since})` : ''}:`);
        console.log(`  Total: ${s.total}`);
        console.log(
          `  Errors: ${s.errors} (${s.total ? Math.round((s.errors / s.total) * 100) : 0}%)`
        );
        console.log(`  Avg Duration: ${s.avgDuration_ms}ms`);
        console.log(`\nStatus Codes:`);
        for (const [code, count] of Object.entries(s.statusCodes)) {
          console.log(`  ${code}: ${count}`);
        }
        console.log(`\nTop Jurisdictions:`);
        for (const j of s.topJurisdictions) {
          console.log(`  ${j.id}: ${j.count}`);
        }
        console.log(`\nTop Routes:`);
        for (const r of s.topRoutes) {
          console.log(`  ${r.route}: ${r.count}`);
        }
      } else if (sub === 'errors') {
        const entries = await requestLog.query({
          jurisdiction,
          status: 'error',
          since,
          limit,
        });
        for (const e of entries) {
          console.log(
            `${e.ts}  ${e.status}  ${e.method} ${e.path}  ${e.error || ''}`
          );
        }
        console.log(`\n${entries.length} errors shown.`);
      } else {
        const entries = await requestLog.query({
          jurisdiction,
          since,
          limit,
        });
        for (const e of entries) {
          const dur = `${e.duration_ms}ms`.padStart(7);
          console.log(
            `${e.ts}  ${e.status}  ${dur}  ${e.method} ${e.path}`
          );
        }
        console.log(`\n${entries.length} requests shown.`);
      }
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
