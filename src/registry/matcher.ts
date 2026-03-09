/**
 * Matcher — cross-references registry entries with Census Bureau places
 * to populate geographic coordinates and population data.
 *
 * Matching strategies (applied in order):
 * 1. FIPS code match (exact)
 * 2. Normalized name + state match (exact)
 * 3. Fuzzy name match within state (token similarity > 0.85)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry } from './types.js';
import type { CensusPlace } from './census-loader.js';

export interface MatcherOptions {
  dataDir?: string;
  onProgress?: (msg: string) => void;
}

export interface MatchResult {
  matched: number;
  unmatched: number;
  total: number;
  byStrategy: Record<string, number>;
}

export async function matchRegistryToCensus(options: MatcherOptions = {}): Promise<MatchResult> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');
  const log = options.onProgress || console.log;

  const registryPath = join(dataDir, 'registry.json');
  const censusPath = join(dataDir, 'census-places.json');

  if (!existsSync(registryPath)) {
    throw new Error(`Registry not found at ${registryPath}. Run 'catalog' first.`);
  }
  if (!existsSync(censusPath)) {
    throw new Error(`Census data not found at ${censusPath}. Run 'census' first.`);
  }

  const registry: RegistryEntry[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
  const censusPlaces: CensusPlace[] = JSON.parse(readFileSync(censusPath, 'utf-8'));

  log(`[matcher] ${registry.length} registry entries, ${censusPlaces.length} census places`);

  // Build lookup indexes
  const byFips = new Map<string, CensusPlace>();
  const byStateAndName = new Map<string, CensusPlace[]>();

  for (const place of censusPlaces) {
    byFips.set(place.fips, place);

    const key = `${place.state}:${normalize(place.name)}`;
    const list = byStateAndName.get(key) || [];
    list.push(place);
    byStateAndName.set(key, list);
  }

  const result: MatchResult = {
    matched: 0,
    unmatched: 0,
    total: registry.length,
    byStrategy: { fips: 0, exact_name: 0, fuzzy_name: 0 },
  };

  for (const entry of registry) {
    // Skip non-geographic entries (federal, state-level)
    if (entry.type === 'federal' || entry.type === 'state') {
      // For states, use state centroid from census
      if (entry.type === 'state' && entry.state) {
        const statePlace = censusPlaces.find(p => p.type === 'state' && p.state === entry.state);
        if (statePlace) {
          entry.lat = statePlace.lat;
          entry.lng = statePlace.lng;
          entry.population = statePlace.pop;
          entry.censusMatch = statePlace.fips;
          result.matched++;
          result.byStrategy['state_centroid'] = (result.byStrategy['state_centroid'] || 0) + 1;
          continue;
        }
      }
      result.unmatched++;
      continue;
    }

    if (!entry.state) {
      result.unmatched++;
      continue;
    }

    // Strategy 1: FIPS match
    if (entry.fips) {
      const match = byFips.get(entry.fips);
      if (match) {
        applyMatch(entry, match, 'fips');
        result.matched++;
        result.byStrategy['fips']++;
        continue;
      }
    }

    // Strategy 2: Exact normalized name + state
    const normalizedName = extractCityName(entry.name);
    const nameKey = `${entry.state}:${normalize(normalizedName)}`;
    const exactMatches = byStateAndName.get(nameKey);
    if (exactMatches && exactMatches.length > 0) {
      // Prefer "place" type over "county"
      const best = exactMatches.find(p => p.type === 'place') || exactMatches[0];
      applyMatch(entry, best, 'exact_name');
      result.matched++;
      result.byStrategy['exact_name']++;
      continue;
    }

    // Strategy 3: Fuzzy name match within same state
    const statePrefix = `${entry.state}:`;
    let bestScore = 0;
    let bestMatch: CensusPlace | null = null;

    for (const [key, places] of byStateAndName) {
      if (!key.startsWith(statePrefix)) continue;
      const censusName = key.substring(statePrefix.length);
      const score = tokenSimilarity(normalize(normalizedName), censusName);
      if (score > bestScore && score >= 0.85) {
        bestScore = score;
        bestMatch = places.find(p => p.type === 'place') || places[0];
      }
    }

    if (bestMatch) {
      applyMatch(entry, bestMatch, 'fuzzy_name');
      result.matched++;
      result.byStrategy['fuzzy_name']++;
    } else {
      result.unmatched++;
    }
  }

  // Write updated registry
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  log(`[matcher] Results: ${result.matched} matched, ${result.unmatched} unmatched`);
  log(`[matcher] By strategy: ${JSON.stringify(result.byStrategy)}`);

  return result;
}

function applyMatch(entry: RegistryEntry, place: CensusPlace, _strategy: string): void {
  entry.fips = place.fips;
  entry.lat = place.lat;
  entry.lng = place.lng;
  entry.population = place.pop;
  entry.censusMatch = place.fips;
}

/** Extract city name from display names like "Mountain View, CA" or "City of Palm Desert" */
function extractCityName(name: string): string {
  return name
    .replace(/,\s*[A-Z]{2}$/, '')         // Remove ", CA" suffix
    .replace(/^City of /i, '')
    .replace(/^Town of /i, '')
    .replace(/^Village of /i, '')
    .replace(/^Borough of /i, '')
    .replace(/^Township of /i, '')
    .trim();
}

/** Normalize a name for comparison: lowercase, strip punctuation, collapse spaces */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-based similarity: Jaccard similarity on word sets */
function tokenSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
