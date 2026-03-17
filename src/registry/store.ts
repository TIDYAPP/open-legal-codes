/**
 * RegistryStore — in-memory store for the comprehensive jurisdiction registry.
 * Loads data/registry.json on initialization and provides filtered queries.
 * Also loads Census places as fallback search results for jurisdictions
 * not yet matched to a publisher.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry, RegistryStats } from './types.js';
import type { CensusPlace } from './census-loader.js';
import { AZ_TITLES } from '../crawlers/az-statutes.js';
import type { JurisdictionType } from '../types.js';
import { applyRegistryOverrides } from '../jurisdiction-overrides.js';

const PUBLISHER_PRIORITY = ['municode', 'amlegal', 'ecode360', 'ecfr', 'ca-leginfo', 'ny-openleg', 'fl-statutes', 'usc'];

interface ManualRegistrySource {
  id: string;
  name: string;
  type: JurisdictionType;
  state: string | null;
  parentId: string | null;
  fips?: string | null;
  lat?: number | null;
  lng?: number | null;
  population?: number | null;
  sourceUrl: string;
}

function stripPrefix(name: string): string {
  return name.replace(/^(City of|Town of|Village of|County of|Borough of)\s+/i, '');
}

function stripStateSuffix(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Convert a CensusPlace to a synthetic RegistryEntry */
function censusToEntry(place: CensusPlace): RegistryEntry {
  const id = `${place.state.toLowerCase()}-${slugify(place.name)}`;
  return {
    id,
    name: `${place.name}, ${place.state}`,
    type: place.type === 'county' ? 'county' : 'city',
    state: place.state,
    fips: place.fips,
    lat: place.lat,
    lng: place.lng,
    population: place.pop,
    publisher: 'unknown',
    sourceId: '',
    sourceUrl: '',
    status: 'discoverable',
    censusMatch: place.fips,
    lastScanned: '',
  };
}

function manualSourceToEntry(source: ManualRegistrySource): RegistryEntry {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    state: source.state,
    fips: source.fips ?? null,
    lat: source.lat ?? null,
    lng: source.lng ?? null,
    population: source.population ?? null,
    publisher: 'manual',
    sourceId: source.id,
    sourceUrl: source.sourceUrl,
    status: 'available',
    censusMatch: source.fips ?? null,
    lastScanned: new Date().toISOString(),
  };
}

export class RegistryStore {
  private entries: RegistryEntry[] = [];
  private byState = new Map<string, RegistryEntry[]>();
  private byPublisher = new Map<string, RegistryEntry[]>();
  private byId = new Map<string, RegistryEntry>();
  private bySlug = new Map<string, RegistryEntry>();
  private dataDir: string;

  // Census fallback: loaded from disk on demand, cached per-state
  private censusByStateCache = new Map<string, CensusPlace[]>();
  private censusLoaded = false;
  private censusTotal = 0;
  private registryFips = new Set<string>();

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(process.cwd(), 'data');
  }

  initialize(): void {
    const registryPath = join(this.dataDir, 'registry.json');
    if (!existsSync(registryPath)) {
      console.warn(`[RegistryStore] No registry.json found at ${registryPath}. Run 'catalog' command first.`);
      return;
    }

    this.entries = JSON.parse(readFileSync(registryPath, 'utf-8')).map(applyRegistryOverrides);

    const knownIds = new Set(this.entries.map(e => e.id));

    // Load known AMLegal jurisdictions (major cities not discoverable via API)
    const amlegalPath = join(this.dataDir, 'amlegal-known.json');
    if (existsSync(amlegalPath)) {
      const amlegalKnown: Array<{ name: string; state: string; slug: string; fips: string }> =
        JSON.parse(readFileSync(amlegalPath, 'utf-8'));

      let added = 0;
      for (const known of amlegalKnown) {
        const id = `${known.state.toLowerCase()}-${slugify(known.name)}`;
        if (knownIds.has(id)) continue;
        const nameLC = known.name.toLowerCase();
        const isCounty = nameLC.includes('county') && !nameLC.includes('city and county') && !nameLC.includes('city & county');
        this.entries.push({
          id,
          name: `${known.name}, ${known.state}`,
          type: isCounty ? 'county' : 'city',
          state: known.state,
          fips: known.fips,
          lat: null,
          lng: null,
          population: null,
          publisher: 'amlegal',
          sourceId: known.slug,
          sourceUrl: `https://codelibrary.amlegal.com/codes/${known.slug}/latest/overview`,
          status: 'available',
          censusMatch: known.fips,
          lastScanned: new Date().toISOString(),
        });
        knownIds.add(id);
        added += 1;
      }
      console.log(`[RegistryStore] Added ${added} known AMLegal jurisdictions`);
    }

    // Add Arizona state-local-government statutes so production can expose them
    // without rebuilding the full registry catalog.
    let azAdded = 0;
    for (const title of AZ_TITLES) {
      const id = `az-${title.slug}`;
      if (knownIds.has(id)) continue;
      this.entries.push({
        id,
        name: `Arizona Title ${title.number} - ${title.name}`,
        type: 'state',
        state: 'AZ',
        fips: '04',
        lat: null,
        lng: null,
        population: null,
        publisher: 'az-statutes',
        sourceId: title.number,
        sourceUrl: `https://www.azleg.gov/arsDetail?title=${title.number}`,
        status: 'available',
        censusMatch: '04',
        lastScanned: new Date().toISOString(),
      });
      knownIds.add(id);
      azAdded += 1;
    }
    if (azAdded > 0) {
      console.log(`[RegistryStore] Added ${azAdded} Arizona local-government statute entries`);
    }

    // Bootstrap state statute crawlers that exist but aren't in the registry catalog
    const STATE_STATUTES: Array<{ id: string; name: string; state: string; fips: string; publisher: string; sourceId: string; sourceUrl: string }> = [
      { id: 'wa-statutes', name: 'Revised Code of Washington', state: 'WA', fips: '53', publisher: 'wa-statutes', sourceId: 'wa-statutes', sourceUrl: 'https://apps.leg.wa.gov/rcw/default.aspx' },
      { id: 'nc-statutes', name: 'North Carolina General Statutes', state: 'NC', fips: '37', publisher: 'nc-statutes', sourceId: 'nc-statutes', sourceUrl: 'https://www.ncleg.gov/Laws/GeneralStatutesTOC' },
      { id: 'va-statutes', name: 'Code of Virginia', state: 'VA', fips: '51', publisher: 'va-statutes', sourceId: 'va-statutes', sourceUrl: 'https://law.lis.virginia.gov/vacode/' },
      { id: 'oh-statutes', name: 'Ohio Revised Code', state: 'OH', fips: '39', publisher: 'oh-statutes', sourceId: 'oh-statutes', sourceUrl: 'https://codes.ohio.gov/ohio-revised-code' },
      { id: 'ma-statutes', name: 'Massachusetts General Laws', state: 'MA', fips: '25', publisher: 'ma-statutes', sourceId: 'ma-statutes', sourceUrl: 'https://malegislature.gov/Laws/GeneralLaws' },
      { id: 'pa-statutes', name: 'Pennsylvania Consolidated Statutes', state: 'PA', fips: '42', publisher: 'pa-statutes', sourceId: 'pa-statutes', sourceUrl: 'https://www.legis.state.pa.us/cfdocs/legis/LI/Public/cons_index.cfm' },
      { id: 'nj-statutes', name: 'New Jersey Statutes', state: 'NJ', fips: '34', publisher: 'nj-statutes', sourceId: 'nj-statutes', sourceUrl: 'https://lis.njleg.state.nj.us/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish:10.1048/Enu' },
      { id: 'ga-statutes', name: 'Official Code of Georgia', state: 'GA', fips: '13', publisher: 'ga-statutes', sourceId: 'ga-statutes', sourceUrl: 'https://www.legis.ga.gov/laws/en-US' },
      { id: 'co-statutes', name: 'Colorado Revised Statutes', state: 'CO', fips: '08', publisher: 'co-statutes', sourceId: 'co-statutes', sourceUrl: 'https://colorado.public.law/statutes' },
    ];
    let stateStatutesAdded = 0;
    for (const s of STATE_STATUTES) {
      if (knownIds.has(s.id)) continue;
      this.entries.push({
        id: s.id,
        name: s.name,
        type: 'state',
        state: s.state,
        fips: s.fips,
        lat: null,
        lng: null,
        population: null,
        publisher: s.publisher,
        sourceId: s.sourceId,
        sourceUrl: s.sourceUrl,
        status: 'available',
        censusMatch: s.fips,
        lastScanned: new Date().toISOString(),
      });
      knownIds.add(s.id);
      stateStatutesAdded += 1;
    }
    if (stateStatutesAdded > 0) {
      console.log(`[RegistryStore] Added ${stateStatutesAdded} state statute entries`);
    }

    // Load official manual sources (counties, HOAs, and other sources without a
    // standard publisher API) so production lookup can resolve them without a
    // full registry rebuild.
    const manualPath = join(this.dataDir, 'manual-sources.json');
    if (existsSync(manualPath)) {
      const manualSources: ManualRegistrySource[] = JSON.parse(readFileSync(manualPath, 'utf-8'));
      let added = 0;

      for (const source of manualSources) {
        if (knownIds.has(source.id)) continue;
        this.entries.push(manualSourceToEntry(source));
        knownIds.add(source.id);
        added += 1;
      }

      if (added > 0) {
        console.log(`[RegistryStore] Added ${added} manual source entries`);
      }
    }

    // Build indexes
    this.byState.clear();
    this.byPublisher.clear();
    this.byId.clear();
    this.bySlug.clear();
    this.registryFips.clear();

    for (const entry of this.entries) {
      this.byId.set(entry.id, entry);

      if (entry.fips) {
        this.registryFips.add(entry.fips);
      }

      if (entry.state) {
        const list = this.byState.get(entry.state) || [];
        list.push(entry);
        this.byState.set(entry.state, list);
      }

      const pubList = this.byPublisher.get(entry.publisher) || [];
      pubList.push(entry);
      this.byPublisher.set(entry.publisher, pubList);

      // bySlug index — keyed as "{state}-{slugified-name}" or "federal-{id-slug}" for federal entries
      const slugKey = entry.state
        ? `${entry.state.toLowerCase()}-${slugify(stripStateSuffix(stripPrefix(entry.name)))}`
        : entry.type === 'federal'
          ? `federal-${entry.id.replace(/^us-/, '')}`
          : null;
      if (slugKey) {
        const existing = this.bySlug.get(slugKey);
        if (!existing) {
          this.bySlug.set(slugKey, entry);
        } else {
          // Prefer higher-priority publisher
          const existingPriority = PUBLISHER_PRIORITY.indexOf(existing.publisher);
          const newPriority = PUBLISHER_PRIORITY.indexOf(entry.publisher);
          if (newPriority >= 0 && (existingPriority < 0 || newPriority < existingPriority)) {
            this.bySlug.set(slugKey, entry);
          }
        }
      }
    }

    // Census places are loaded lazily from disk on first access
    this.censusByStateCache.clear();
    this.censusLoaded = false;
    this.censusTotal = 0;

    console.log(`[RegistryStore] Loaded ${this.entries.length} registry entries`);
  }

  /** Load census places from disk and index by state (called once on first access) */
  private ensureCensusLoaded(): void {
    if (this.censusLoaded) return;
    this.censusLoaded = true;

    const censusPath = join(this.dataDir, 'census-places.json');
    if (!existsSync(censusPath)) return;

    const places: CensusPlace[] = JSON.parse(readFileSync(censusPath, 'utf-8'));
    this.censusTotal = places.length;
    for (const place of places) {
      const list = this.censusByStateCache.get(place.state) || [];
      list.push(place);
      this.censusByStateCache.set(place.state, list);
    }
    console.log(`[RegistryStore] Loaded ${places.length} census places from disk`);
  }

  /** Get census places for a state (loads from disk on first access) */
  private getCensusForState(state: string): CensusPlace[] {
    this.ensureCensusLoaded();
    return this.censusByStateCache.get(state.toUpperCase()) || [];
  }

  /** Get all census places (loads from disk on first access) */
  private getAllCensusPlaces(): CensusPlace[] {
    this.ensureCensusLoaded();
    const all: CensusPlace[] = [];
    for (const places of this.censusByStateCache.values()) {
      all.push(...places);
    }
    return all;
  }

  /** Query registry entries with optional filters */
  query(filters?: {
    state?: string;
    publisher?: string;
    status?: string;
    hasGeo?: boolean;
    type?: string;
    bbox?: { west: number; south: number; east: number; north: number };
  }): RegistryEntry[] {
    let results = this.entries;

    if (filters?.state) {
      results = this.byState.get(filters.state.toUpperCase()) || [];
    }

    if (filters?.publisher) {
      if (filters.state) {
        results = results.filter(e => e.publisher === filters.publisher);
      } else {
        results = this.byPublisher.get(filters.publisher) || [];
      }
    }

    if (filters?.status) {
      results = results.filter(e => e.status === filters.status);
    }

    if (filters?.type) {
      results = results.filter(e => e.type === filters.type);
    }

    if (filters?.hasGeo) {
      results = results.filter(e => e.lat !== null && e.lng !== null);
    }

    if (filters?.bbox) {
      const { west, south, east, north } = filters.bbox;
      results = results.filter(e =>
        e.lat !== null && e.lng !== null &&
        e.lat >= south && e.lat <= north &&
        e.lng >= west && e.lng <= east
      );
    }

    return results;
  }

  /** Compact geo format for map rendering */
  getGeoEntries(): Array<{
    id: string;
    lat: number;
    lng: number;
    s: string;
    p: string;
    t: string;
    n: string;
    st: string | null;
    pop: number | null;
  }> {
    return this.entries
      .filter(e => e.lat !== null && e.lng !== null)
      .map(e => ({
        id: e.id,
        lat: e.lat!,
        lng: e.lng!,
        s: e.status,
        p: e.publisher,
        t: e.type,
        n: e.name,
        st: e.state,
        pop: e.population,
      }));
  }

  /** Aggregate statistics including census places */
  getStats(): RegistryStats {
    const stats: RegistryStats = {
      total: this.entries.length + this.getAllCensusPlaces().filter(p => !this.registryFips.has(p.fips)).length,
      byPublisher: {},
      byStatus: {},
      byType: {},
      byState: {},
    };

    for (const e of this.entries) {
      stats.byPublisher[e.publisher] = (stats.byPublisher[e.publisher] || 0) + 1;
      stats.byStatus[e.status] = (stats.byStatus[e.status] || 0) + 1;
      stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
      if (e.state) {
        stats.byState[e.state] = (stats.byState[e.state] || 0) + 1;
      }
    }

    return stats;
  }

  /** Look up a single registry entry by its ID */
  getById(id: string): RegistryEntry | undefined {
    return this.byId.get(id);
  }

  /** Look up by state + slug (e.g., "ca", "palm-desert").
   *  Falls back to census data if no registry match. */
  getBySlug(state: string, slug: string): RegistryEntry | undefined {
    const key = `${state.toLowerCase()}-${slug}`;
    const entry = this.bySlug.get(key);
    if (entry) return entry;

    // Fallback: search census places by slug match
    const statePlaces = this.getCensusForState(state);
    const match = statePlaces.find(p => slugify(p.name) === slug);
    if (match && !this.registryFips.has(match.fips)) {
      return censusToEntry(match);
    }
    return undefined;
  }

  /** Case-insensitive substring match on name, stripping common prefixes.
   *  Results sorted by: exact match first, then known publishers, then by population. */
  findByName(name: string, state?: string): RegistryEntry[] {
    const needle = stripPrefix(name).toLowerCase();
    let candidates = state
      ? (this.byState.get(state.toUpperCase()) || [])
      : this.entries;

    const matches = candidates.filter(e => {
      const stripped = stripPrefix(e.name).toLowerCase();
      return stripped.includes(needle);
    });

    // Collect FIPS codes already in registry matches to deduplicate
    const matchedFips = new Set(matches.map(e => e.fips).filter(Boolean));

    // Search census places for additional matches
    const censusPool = state
      ? this.getCensusForState(state)
      : this.getAllCensusPlaces();

    const censusMatches = censusPool.filter(p => {
      if (p.type === 'state') return false; // State-level census entries shouldn't appear as city/county lookup candidates
      if (this.registryFips.has(p.fips) || matchedFips.has(p.fips)) return false;
      return p.name.toLowerCase().includes(needle);
    });

    // Convert census matches to RegistryEntry and merge
    const censusEntries = censusMatches.map(censusToEntry);
    const all = [...matches, ...censusEntries];

    // Sort: exact name matches first, then known publishers, then by population
    all.sort((a, b) => {
      const aName = stripPrefix(a.name).toLowerCase().replace(/,\s*[a-z]{2}$/i, '');
      const bName = stripPrefix(b.name).toLowerCase().replace(/,\s*[a-z]{2}$/i, '');
      const aExact = aName === needle ? 1 : 0;
      const bExact = bName === needle ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      // Known publisher beats unknown
      const aKnown = a.publisher !== 'unknown' ? 1 : 0;
      const bKnown = b.publisher !== 'unknown' ? 1 : 0;
      if (aKnown !== bKnown) return bKnown - aKnown;

      // Within same source type, sort by publisher priority or population
      if (aKnown && bKnown) {
        const pa = PUBLISHER_PRIORITY.indexOf(a.publisher);
        const pb = PUBLISHER_PRIORITY.indexOf(b.publisher);
        return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
      }

      // Census entries: sort by population descending
      return (b.population || 0) - (a.population || 0);
    });

    return all;
  }

  /** Add a discovered entry to the in-memory index */
  addEntry(entry: RegistryEntry): void {
    const normalized = applyRegistryOverrides(entry);

    this.entries.push(normalized);
    this.byId.set(normalized.id, normalized);
    if (normalized.fips) this.registryFips.add(normalized.fips);
    if (normalized.state) {
      const list = this.byState.get(normalized.state) || [];
      list.push(normalized);
      this.byState.set(normalized.state, list);

      const slugKey = `${normalized.state.toLowerCase()}-${slugify(stripStateSuffix(stripPrefix(normalized.name)))}`;
      this.bySlug.set(slugKey, normalized);
    } else if (normalized.type === 'federal') {
      const slugKey = `federal-${normalized.id.replace(/^us-/, '')}`;
      this.bySlug.set(slugKey, normalized);
    }
    const pubList = this.byPublisher.get(normalized.publisher) || [];
    pubList.push(normalized);
    this.byPublisher.set(normalized.publisher, pubList);
  }

  get size(): number {
    return this.entries.length;
  }

  get totalSearchable(): number {
    const extraCensus = this.getAllCensusPlaces().filter(p => !this.registryFips.has(p.fips)).length;
    return this.entries.length + extraCensus;
  }
}

export const registryStore = new RegistryStore();
