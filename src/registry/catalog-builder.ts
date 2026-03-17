/**
 * Catalog Builder — scans all publisher adapters to build a comprehensive
 * registry of every discoverable jurisdiction.
 *
 * Usage:
 *   npx tsx src/cli.ts catalog [--publisher municode] [--state CA]
 *
 * Output: data/registry.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCrawler, PUBLISHERS } from '../crawlers/index.js';
import type { Jurisdiction } from '../types.js';
import type { RegistryEntry } from './types.js';

const STATE_ABBRS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

/** Publishers that need state-by-state enumeration */
const NEEDS_STATE_FILTER = new Set(['ecode360']);

/** Publishers that yield nothing from listJurisdictions */
const SKIP_PUBLISHERS = new Set<string>([]);

export interface CatalogOptions {
  /** Scan only this publisher */
  publisher?: string;
  /** Scan only this state (for publishers that support it) */
  state?: string;
  /** Path to data/ directory */
  dataDir?: string;
  /** Path to codes/ directory (to check cached status) */
  codesDir?: string;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

/**
 * Build the registry by scanning publisher catalogs.
 * Merges with existing registry data to preserve geo fields from Census matching.
 */
export async function buildCatalog(options: CatalogOptions = {}): Promise<RegistryEntry[]> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');
  const codesDir = options.codesDir || join(process.cwd(), 'codes');
  const log = options.onProgress || console.log;

  // Load existing registry to preserve census-matched geo data
  const registryPath = join(dataDir, 'registry.json');
  const existing = new Map<string, RegistryEntry>();
  if (existsSync(registryPath)) {
    const raw: RegistryEntry[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
    for (const entry of raw) {
      existing.set(`${entry.publisher}:${entry.sourceId}`, entry);
    }
    log(`[catalog] Loaded ${existing.size} existing registry entries`);
  }

  // Load cached jurisdictions to determine status
  const cached = new Set<string>();
  const jurisdictionsPath = join(codesDir, 'jurisdictions.json');
  if (existsSync(jurisdictionsPath)) {
    const jurisdictions: Jurisdiction[] = JSON.parse(readFileSync(jurisdictionsPath, 'utf-8'));
    for (const j of jurisdictions) {
      cached.add(`${j.publisher.name}:${j.publisher.sourceId}`);
    }
  }

  const publishers = options.publisher
    ? [options.publisher]
    : PUBLISHERS.filter(p => !SKIP_PUBLISHERS.has(p));

  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const publisherName of publishers) {
    if (SKIP_PUBLISHERS.has(publisherName)) {
      log(`[catalog] Skipping ${publisherName} (no automated listing)`);
      continue;
    }

    log(`[catalog] Scanning ${publisherName}...`);
    const crawler = getCrawler(publisherName);

    try {
      if (NEEDS_STATE_FILTER.has(publisherName)) {
        // Enumerate state by state
        const states = options.state ? [options.state.toUpperCase()] : STATE_ABBRS;
        for (const abbr of states) {
          log(`[catalog]   ${publisherName} → ${abbr}`);
          let stateCount = 0;
          try {
            for await (const j of crawler.listJurisdictions(abbr)) {
              const key = `${publisherName}:${j.publisher.sourceId}`;
              if (seen.has(key)) continue;
              seen.add(key);

              entries.push(jurisdictionToEntry(j, publisherName, cached.has(key), existing.get(key), now));
              stateCount++;
            }
          } catch (err) {
            log(`[catalog]   Warning: ${publisherName}/${abbr} failed: ${err}`);
          }
          log(`[catalog]   ${publisherName} → ${abbr}: ${stateCount} jurisdictions`);
        }
      } else {
        // Single call (municode iterates all states internally, ecfr/ca-leginfo are small)
        let count = 0;
        for await (const j of crawler.listJurisdictions(options.state)) {
          const key = `${publisherName}:${j.publisher.sourceId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          entries.push(jurisdictionToEntry(j, publisherName, cached.has(key), existing.get(key), now));
          count++;
          if (count % 500 === 0) {
            log(`[catalog]   ${publisherName}: ${count} jurisdictions so far...`);
          }
        }
        log(`[catalog]   ${publisherName}: ${count} jurisdictions total`);
      }
    } finally {
      // Clean up if crawler has dispose (e.g., Browserbase)
      if (typeof (crawler as any).dispose === 'function') {
        await (crawler as any).dispose();
      }
    }
  }

  // Merge with existing entries that weren't part of this scan
  const scannedPublishers = new Set(publishers);
  for (const [key, entry] of existing) {
    if (seen.has(key)) continue; // Already in new results
    // Keep entries from publishers we didn't scan
    if (!scannedPublishers.has(entry.publisher)) {
      entries.push(entry);
      continue;
    }
    // If we scanned with a state filter, keep entries from other states
    if (options.state && entry.state !== options.state.toUpperCase()) {
      entries.push(entry);
    }
  }

  // Sort by state, then name for stable output
  entries.sort((a, b) => {
    const stateCompare = (a.state || '').localeCompare(b.state || '');
    if (stateCompare !== 0) return stateCompare;
    return a.name.localeCompare(b.name);
  });

  // Write registry
  writeFileSync(registryPath, JSON.stringify(entries, null, 2));
  log(`[catalog] Wrote ${entries.length} entries to ${registryPath}`);

  return entries;
}

function jurisdictionToEntry(
  j: Jurisdiction,
  publisherName: string,
  isCached: boolean,
  existing: RegistryEntry | undefined,
  now: string,
): RegistryEntry {
  return {
    id: j.id,
    name: j.name,
    type: j.type,
    state: j.state,
    fips: existing?.fips ?? j.fips,
    lat: existing?.lat ?? null,
    lng: existing?.lng ?? null,
    population: existing?.population ?? null,
    publisher: publisherName,
    sourceId: j.publisher.sourceId,
    sourceUrl: j.publisher.url,
    status: isCached ? 'cached' : 'available',
    censusMatch: existing?.censusMatch ?? null,
    lastScanned: now,
  };
}
