/**
 * RegistryStore — in-memory store for the comprehensive jurisdiction registry.
 * Loads data/registry.json on initialization and provides filtered queries.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry, RegistryStats } from './types.js';

const PUBLISHER_PRIORITY = ['municode', 'amlegal', 'ecode360', 'ecfr', 'ca-leginfo'];

function stripPrefix(name: string): string {
  return name.replace(/^(City of|Town of|Village of|County of|Borough of)\s+/i, '');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export class RegistryStore {
  private entries: RegistryEntry[] = [];
  private byState = new Map<string, RegistryEntry[]>();
  private byPublisher = new Map<string, RegistryEntry[]>();
  private byId = new Map<string, RegistryEntry>();
  private bySlug = new Map<string, RegistryEntry>();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(process.cwd(), 'data');
  }

  initialize(): void {
    const registryPath = join(this.dataDir, 'registry.json');
    if (!existsSync(registryPath)) {
      console.warn(`[RegistryStore] No registry.json found at ${registryPath}. Run 'catalog' command first.`);
      return;
    }

    this.entries = JSON.parse(readFileSync(registryPath, 'utf-8'));

    // Build indexes
    for (const entry of this.entries) {
      // byId index
      this.byId.set(entry.id, entry);

      if (entry.state) {
        const list = this.byState.get(entry.state) || [];
        list.push(entry);
        this.byState.set(entry.state, list);
      }

      const pubList = this.byPublisher.get(entry.publisher) || [];
      pubList.push(entry);
      this.byPublisher.set(entry.publisher, pubList);

      // bySlug index — keyed as "{state}-{slugified-name}"
      if (entry.state) {
        const slug = slugify(stripPrefix(entry.name));
        const slugKey = `${entry.state.toLowerCase()}-${slug}`;
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

    console.log(`[RegistryStore] Loaded ${this.entries.length} registry entries`);
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

  /** Aggregate statistics */
  getStats(): RegistryStats {
    const stats: RegistryStats = {
      total: this.entries.length,
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

  /** Look up by state + slug (e.g., "ca", "palm-desert") */
  getBySlug(state: string, slug: string): RegistryEntry | undefined {
    const key = `${state.toLowerCase()}-${slug}`;
    return this.bySlug.get(key);
  }

  /** Case-insensitive substring match on name, stripping common prefixes.
   *  Results sorted by publisher priority. */
  findByName(name: string, state?: string): RegistryEntry[] {
    const needle = stripPrefix(name).toLowerCase();
    let candidates = state
      ? (this.byState.get(state.toUpperCase()) || [])
      : this.entries;

    const matches = candidates.filter(e => {
      const stripped = stripPrefix(e.name).toLowerCase();
      return stripped.includes(needle);
    });

    // Sort by publisher priority
    matches.sort((a, b) => {
      const pa = PUBLISHER_PRIORITY.indexOf(a.publisher);
      const pb = PUBLISHER_PRIORITY.indexOf(b.publisher);
      return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
    });

    return matches;
  }

  get size(): number {
    return this.entries.length;
  }
}

export const registryStore = new RegistryStore();
