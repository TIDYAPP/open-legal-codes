/**
 * Publisher Discovery — lazily discovers which publisher hosts a given jurisdiction.
 * Tries each publisher in order and returns a RegistryEntry on success.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MunicodeCrawler } from '../crawlers/municode.js';
import { createFallbackClient } from '../crawlers/browserbase-client.js';
import type { RegistryEntry } from './types.js';
import { registryStore } from './store.js';

const AMLEGAL_BASE = 'https://codelibrary.amlegal.com';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Try to discover which publisher hosts a jurisdiction's legal code.
 * Returns a RegistryEntry with publisher info, or null if not found.
 */
export async function discoverPublisher(
  name: string,
  state: string,
  opts?: { fips?: string; lat?: number; lng?: number; population?: number; type?: 'city' | 'county' },
): Promise<RegistryEntry | null> {
  const slug = slugify(name);
  const id = `${state.toLowerCase()}-${slug}`;

  console.log(`[discovery] Looking up publisher for ${name}, ${state}...`);

  const type = opts?.type || inferType(name);

  // 1. Try Municode
  const municodeResult = await tryMunicode(name, state);
  if (municodeResult) {
    const entry = buildEntry(id, name, state, 'municode', municodeResult.sourceId, municodeResult.sourceUrl, { ...opts, type });
    console.log(`[discovery] Found ${name}, ${state} on Municode`);
    await persistEntry(entry);
    return entry;
  }

  // 2. Try AMLegal
  const amlegalResult = await tryAmlegal(name, state);
  if (amlegalResult) {
    const entry = buildEntry(id, name, state, 'amlegal', amlegalResult.sourceId, amlegalResult.sourceUrl, { ...opts, type });
    console.log(`[discovery] Found ${name}, ${state} on AMLegal`);
    await persistEntry(entry);
    return entry;
  }

  console.log(`[discovery] No publisher found for ${name}, ${state}`);
  return null;
}

async function tryMunicode(name: string, state: string): Promise<{ sourceId: string; sourceUrl: string } | null> {
  try {
    const crawler = new MunicodeCrawler();
    const result = await crawler.lookupByName(name, state);
    if (result) {
      return {
        sourceId: result.publisher.sourceId,
        sourceUrl: result.publisher.url,
      };
    }
  } catch (err: any) {
    console.warn(`[discovery] Municode lookup failed: ${err.message}`);
  }
  return null;
}

async function tryAmlegal(name: string, state: string): Promise<{ sourceId: string; sourceUrl: string } | null> {
  // AMLegal uses URL slugs like "chicago", "san_francisco"
  // Try common slug patterns
  const slugVariants = [
    slugify(name).replace(/-/g, '_'),  // chicago, palm_desert
    slugify(name),                      // chicago, palm-desert
  ];

  // Use FallbackHttpClient which tries plain HTTP first, then Browserbase
  // if Cloudflare blocks us (AMLegal has aggressive bot protection)
  const http = createFallbackClient({ minDelayMs: 200 });

  for (const slug of slugVariants) {
    const url = `${AMLEGAL_BASE}/codes/${slug}/latest/overview`;
    try {
      const html = await http.getHtml(url);
      // If we got HTML with Redux state, this jurisdiction exists on AMLegal
      if (html.includes('window._redux_state')) {
        return { sourceId: slug, sourceUrl: url };
      }
    } catch {
      // 403/404/timeout — skip
    }
  }

  return null;
}

function inferType(name: string): 'city' | 'county' {
  const lower = name.toLowerCase();
  if (lower.includes('city and county') || lower.includes('city & county')) return 'city';
  if (lower.includes('county')) return 'county';
  return 'city';
}

function buildEntry(
  id: string,
  name: string,
  state: string,
  publisher: string,
  sourceId: string,
  sourceUrl: string,
  opts?: { fips?: string; lat?: number; lng?: number; population?: number; type?: 'city' | 'county' },
): RegistryEntry {
  return {
    id,
    name: `${name}, ${state}`,
    type: opts?.type || 'city',
    state,
    fips: opts?.fips || null,
    lat: opts?.lat || null,
    lng: opts?.lng || null,
    population: opts?.population || null,
    publisher,
    sourceId,
    sourceUrl,
    status: 'available',
    censusMatch: opts?.fips || null,
    lastScanned: new Date().toISOString(),
  };
}

/** Persist a newly discovered entry to registry.json and in-memory store */
async function persistEntry(entry: RegistryEntry): Promise<void> {
  registryStore.addEntry(entry);

  // Also write to disk so it survives server restarts
  const registryPath = join(process.cwd(), 'data', 'registry.json');
  try {
    if (existsSync(registryPath)) {
      const entries: RegistryEntry[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
      // Don't add duplicates
      if (!entries.some(e => e.id === entry.id && e.publisher === entry.publisher)) {
        entries.push(entry);
        writeFileSync(registryPath, JSON.stringify(entries, null, 2));
        console.log(`[discovery] Persisted ${entry.id} to registry.json`);
      }
    }
  } catch (err: any) {
    console.warn(`[discovery] Failed to persist to registry.json: ${err.message}`);
  }
}
