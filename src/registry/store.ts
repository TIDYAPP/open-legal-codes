/**
 * RegistryStore — in-memory store for the comprehensive jurisdiction registry.
 * Loads data/registry.json on initialization and provides filtered queries.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry, RegistryStats } from './types.js';

export class RegistryStore {
  private entries: RegistryEntry[] = [];
  private byState = new Map<string, RegistryEntry[]>();
  private byPublisher = new Map<string, RegistryEntry[]>();
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
      if (entry.state) {
        const list = this.byState.get(entry.state) || [];
        list.push(entry);
        this.byState.set(entry.state, list);
      }

      const pubList = this.byPublisher.get(entry.publisher) || [];
      pubList.push(entry);
      this.byPublisher.set(entry.publisher, pubList);
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

  get size(): number {
    return this.entries.length;
  }
}

export const registryStore = new RegistryStore();
