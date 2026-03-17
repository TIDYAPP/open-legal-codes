/**
 * Crawl top 100 STR (short-term rental) markets in the US.
 *
 * Usage:
 *   npx tsx scripts/crawl-str-markets.ts              # start=3, max=5
 *   npx tsx scripts/crawl-str-markets.ts --dry-run    # resolve & list only
 *   npx tsx scripts/crawl-str-markets.ts --start 1 --max 3
 *   npx tsx scripts/crawl-str-markets.ts --skip-cached false
 */

import { RegistryStore } from '../src/registry/store.js';

const API_BASE = 'https://api.openlegalcodes.org/api/v1';
const POLL_INTERVAL_MS = 20_000;   // 20s between polls
const MAX_POLL_MS = 35 * 60_000;   // give up after 35 minutes (matches server-side timeout)

// ─── Top 100 STR markets, ordered by short-term rental activity ───────────────
// Optional `id` field bypasses registry lookup and uses the known jurisdiction ID directly.

const STR_MARKETS: Array<{ city: string; state: string; id?: string }> = [
  { city: 'Nashville', state: 'TN', id: 'tn-metro-government-of-nashville-and-davidson-county' },
  { city: 'New Orleans', state: 'LA' },
  { city: 'Gatlinburg', state: 'TN' },
  { city: 'Miami Beach', state: 'FL' },
  { city: 'Austin', state: 'TX' },
  { city: 'Scottsdale', state: 'AZ' },
  { city: 'Denver', state: 'CO' },
  { city: 'Miami', state: 'FL' },
  { city: 'Orlando', state: 'FL' },
  { city: 'Charleston', state: 'SC' },
  { city: 'Myrtle Beach', state: 'SC' },
  { city: 'Savannah', state: 'GA' },
  { city: 'Key West', state: 'FL' },
  { city: 'Destin', state: 'FL' },
  { city: 'Sedona', state: 'AZ' },
  { city: 'Park City', state: 'UT' },
  { city: 'Aspen', state: 'CO' },
  { city: 'Vail', state: 'CO' },
  { city: 'Jackson', state: 'WY' },
  { city: 'San Diego', state: 'CA' },
  { city: 'Palm Springs', state: 'CA' },
  { city: 'San Francisco', state: 'CA' },
  { city: 'Chicago', state: 'IL' },
  { city: 'Seattle', state: 'WA' },
  { city: 'Portland', state: 'OR' },
  { city: 'Boston', state: 'MA' },
  { city: 'Washington', state: 'DC' },
  { city: 'New York', state: 'NY' },
  { city: 'Philadelphia', state: 'PA' },
  { city: 'Los Angeles', state: 'CA' },
  { city: 'Atlanta', state: 'GA' },
  { city: 'Phoenix', state: 'AZ' },
  { city: 'Tampa', state: 'FL' },
  { city: 'St. Petersburg', state: 'FL' },
  { city: 'Fort Lauderdale', state: 'FL' },
  { city: 'Clearwater', state: 'FL' },
  { city: 'Cape Coral', state: 'FL' },
  { city: 'Naples', state: 'FL' },
  { city: 'Fort Myers', state: 'FL' },
  { city: 'Panama City Beach', state: 'FL' },
  { city: 'Pensacola', state: 'FL' },
  { city: 'Daytona Beach', state: 'FL' },
  { city: 'West Palm Beach', state: 'FL' },
  { city: 'Boca Raton', state: 'FL' },
  { city: 'Flagstaff', state: 'AZ' },
  { city: 'Tucson', state: 'AZ' },
  { city: 'Tempe', state: 'AZ' },
  { city: 'Mesa', state: 'AZ' },
  { city: 'Tallahassee', state: 'FL' },
  { city: 'St. Augustine', state: 'FL' },
  { city: 'Pigeon Forge', state: 'TN' },
  { city: 'Sevierville', state: 'TN' },
  { city: 'Knoxville', state: 'TN' },
  { city: 'Memphis', state: 'TN' },
  { city: 'Chattanooga', state: 'TN' },
  { city: 'Houston', state: 'TX' },
  { city: 'Dallas', state: 'TX' },
  { city: 'San Antonio', state: 'TX' },
  { city: 'Galveston', state: 'TX' },
  { city: 'Fredericksburg', state: 'TX' },
  { city: 'Breckenridge', state: 'CO' },
  { city: 'Estes Park', state: 'CO' },
  { city: 'Boulder', state: 'CO' },
  { city: 'Colorado Springs', state: 'CO' },
  { city: 'Telluride', state: 'CO' },
  { city: 'Steamboat Springs', state: 'CO' },
  { city: 'Portland', state: 'ME' },
  { city: 'Bar Harbor', state: 'ME' },
  { city: 'Newport', state: 'RI' },
  { city: 'Provincetown', state: 'MA' },
  { city: 'Nantucket', state: 'MA' },
  { city: 'Crested Butte', state: 'CO', id: 'co-crested-butte' },
  { city: 'Snowmass Village', state: 'CO', id: 'co-snowmass-village' },
  { city: 'Asheville', state: 'NC' },
  { city: 'Charlotte', state: 'NC' },
  { city: 'Wilmington', state: 'NC' },
  { city: 'Virginia Beach', state: 'VA' },
  { city: 'Richmond', state: 'VA' },
  { city: 'Annapolis', state: 'MD' },
  { city: 'Ocean City', state: 'MD' },
  { city: 'Rehoboth Beach', state: 'DE' },
  { city: 'Williamsburg', state: 'VA' },
  { city: 'Louisville', state: 'KY' },
  { city: 'Lexington', state: 'KY' },
  { city: 'Indianapolis', state: 'IN' },
  { city: 'Minneapolis', state: 'MN' },
  { city: 'Madison', state: 'WI' },
  { city: 'Milwaukee', state: 'WI' },
  { city: 'Kansas City', state: 'MO' },
  { city: 'St. Louis', state: 'MO' },
  { city: 'Omaha', state: 'NE' },
  { city: 'Birmingham', state: 'AL' },
  { city: 'Spokane County', state: 'WA', id: 'wa-spokane-county' },
  { city: 'Albuquerque', state: 'NM' },
  { city: 'Santa Fe', state: 'NM' },
  { city: 'Salt Lake City', state: 'UT' },
  { city: 'Raleigh', state: 'NC' },
  { city: 'Boise', state: 'ID' },
  { city: 'Honolulu', state: 'HI' },
];

// ─── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    startWith: 3,
    maxConcurrent: 5,
    skipCached: true,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--start' && args[i + 1]) opts.startWith = parseInt(args[++i], 10);
    else if (args[i] === '--max' && args[i + 1]) opts.maxConcurrent = parseInt(args[++i], 10);
    else if (args[i] === '--skip-cached' && args[i + 1]) opts.skipCached = args[++i] !== 'false';
  }
  return opts;
}

// ─── Resolution phase ──────────────────────────────────────────────────────────

interface Resolved {
  city: string;
  state: string;
  id: string;
  name: string;
  publisher: string;
  status: 'ready' | 'cached';
}

interface Unresolved {
  city: string;
  state: string;
  reason: string;
}

function resolveCities(): { resolved: Resolved[]; unresolved: Unresolved[] } {
  // Suppress noisy RegistryStore logs
  const origLog = console.log;
  console.log = () => {};
  const store = new RegistryStore();
  store.initialize();
  console.log = origLog;

  const resolved: Resolved[] = [];
  const unresolved: Unresolved[] = [];

  for (const { city, state, id: explicitId } of STR_MARKETS) {
    let matchId: string;
    let matchName: string;
    let matchPublisher: string;

    if (explicitId) {
      const entry = store.getById(explicitId);
      if (!entry) {
        unresolved.push({ city, state, reason: `explicit id '${explicitId}' not found in registry` });
        continue;
      }
      matchId = entry.id;
      matchName = entry.name;
      matchPublisher = entry.publisher;
    } else {
      const results = store.findByName(city, state);
      const match = results.find(r => r.publisher !== 'unknown' && r.status !== 'discoverable');
      if (!match) {
        unresolved.push({ city, state, reason: 'not found in registry' });
        continue;
      }
      matchId = match.id;
      matchName = match.name;
      matchPublisher = match.publisher;
    }

    resolved.push({ city, state, id: matchId, name: matchName, publisher: matchPublisher, status: 'ready' });
  }

  return { resolved, unresolved };
}

// ─── Crawl pool ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = attempt * 10_000;
      console.log(`  fetch error (attempt ${attempt}/${retries}), retrying in ${wait / 1000}s: ${(err as Error).message}`);
      await sleep(wait);
    }
  }
  throw new Error('unreachable');
}

async function crawlOne(item: Resolved, skipCached: boolean): Promise<void> {
  const label = `[${item.city}, ${item.state}]`;
  const url = `${API_BASE}/jurisdictions/${item.id}/toc`;
  const start = Date.now();

  console.log(`\n${label} Triggering: ${url}`);

  // First request triggers auto-crawl on the server if not cached
  let res = await fetchWithRetry(url);

  if (res.status === 200) {
    console.log(`  ${label} Already cached — done`);
    return;
  }

  if (res.status === 404) {
    throw new Error(`${label} Not found on production (404) — jurisdiction may not be in prod registry`);
  }

  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} Unexpected status ${res.status}: ${body.slice(0, 200)}`);
  }

  // 202 — crawl is in progress, poll until done
  console.log(`  ${label} Crawl started (202) — polling every ${POLL_INTERVAL_MS / 1000}s...`);

  while (true) {
    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error(`${label} Timed out after ${MAX_POLL_MS / 60000} minutes`);
    }

    await sleep(POLL_INTERVAL_MS);

    res = await fetchWithRetry(url);

    if (res.status === 200) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  ${label} Done (${elapsed}s)`);
      return;
    }

    if (res.status === 202) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const progress = body.progress as Record<string, unknown> | undefined;
      const pct = progress
        ? ` — ${progress.phase ?? ''} ${progress.completed ?? 0}/${progress.total ?? '?'}`
        : '';
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  ${label} Still crawling (${elapsed}s)${pct}`);
      continue;
    }

    if (res.status === 503) {
      const body = await res.json().catch(() => ({}) as any);
      throw new Error(`${label} 503 CRAWL_FAILED — ${body?.error?.message ?? 'crawl failed on server'}`);
    }

    const body = await res.text().catch(() => '');
    throw new Error(`${label} Poll failed with status ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function runPool(queue: Resolved[], startWith: number, maxConcurrent: number, skipCached: boolean): Promise<void> {
  let idx = 0;
  let failed = false;
  let completed = 0;
  const errors: string[] = [];

  const runNext = (): Promise<void> => {
    if (failed || idx >= queue.length) return Promise.resolve();
    const item = queue[idx++];

    return crawlOne(item, skipCached)
      .then(() => {
        completed++;
        console.log(`\nProgress: ${completed}/${queue.length} complete, ${idx - completed} in-flight, ${queue.length - idx} remaining`);
        return runNext();
      })
      .catch(err => {
        const msg: string = err.message;
        const isSkippable = msg.includes('Timed out') || msg.includes('404') || msg.includes('503');
        if (isSkippable) {
          errors.push(`SKIPPED: ${msg}`);
          console.warn(`\nSkipping (non-fatal): ${msg}`);
          return runNext();
        }
        failed = true;
        errors.push(msg);
        console.error(`\nFatal error: ${msg}`);
        console.error('Stopping remaining crawls...');
        throw err;
      });
  };

  // Start initial batch; each slot chains to the next item when it completes
  const initial = Math.min(startWith, queue.length);
  const initialBatch = Array.from({ length: initial }, () => runNext());

  // Open remaining slots up to maxConcurrent after a short stagger
  const extra = Math.min(maxConcurrent - startWith, queue.length - startWith);
  const extraBatch = extra > 0
    ? Array.from({ length: extra }, (_, i) =>
        sleep((i + 1) * 2000).then(() => runNext())
      )
    : [];

  await Promise.all([...initialBatch, ...extraBatch]);

  if (errors.length) {
    console.error(`\nCrawl stopped with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('─'.repeat(60));
  console.log('STR Markets Crawl');
  console.log(`  Markets:       ${STR_MARKETS.length}`);
  console.log(`  Start with:    ${opts.startWith} concurrent`);
  console.log(`  Max:           ${opts.maxConcurrent} concurrent`);
  console.log(`  Target:        ${API_BASE}`);
  console.log(`  Mode:          ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('─'.repeat(60));

  console.log('\nResolving jurisdictions...');
  const { resolved, unresolved } = resolveCities();

  // Print resolution summary
  console.log(`\nResolution summary:`);
  console.log(`  Found:       ${resolved.length}/${STR_MARKETS.length}`);
  console.log(`  To crawl:    ${resolved.length}`);
  console.log(`  Not found:   ${unresolved.length}`);

  if (unresolved.length > 0) {
    console.log('\nCould not resolve:');
    for (const u of unresolved) {
      console.log(`  ✗ ${u.city}, ${u.state} — ${u.reason}`);
    }
    if (unresolved.length > STR_MARKETS.length * 0.2) {
      console.error('\nToo many unresolved (>20%). Aborting — check registry.');
      process.exit(1);
    }
  }

  if (resolved.length === 0) {
    console.log('\nNothing to crawl.');
    return;
  }

  console.log(`\nWill crawl (in order):`);
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    console.log(`  ${String(i + 1).padStart(3)}. ${r.name.padEnd(40)} ${r.id}`);
  }

  if (opts.dryRun) {
    console.log('\nDry run — exiting without crawling.');
    return;
  }

  console.log(`\nTarget: ${API_BASE}`);
  console.log(`Starting crawl pool (start=${opts.startWith}, max=${opts.maxConcurrent})...`);

  process.on('SIGINT', () => {
    console.log('\nInterrupted.');
    process.exit(130);
  });

  await runPool(resolved, opts.startWith, opts.maxConcurrent, opts.skipCached);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done! Crawled ${resolved.length} jurisdictions.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
