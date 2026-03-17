import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(process.cwd(), 'data');
const LOG_PATH = join(LOG_DIR, 'request-log.jsonl');

export interface RequestLogEntry {
  ts: string;
  method: string;
  path: string;
  jurisdiction: string | null;
  query: Record<string, string>;
  status: number;
  duration_ms: number;
  error: string | null;
}

class RequestLog {
  async append(entry: RequestLogEntry): Promise<void> {
    try {
      if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
      await appendFile(LOG_PATH, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('[request-log] Write failed:', err);
    }
  }

  async query(filters: {
    jurisdiction?: string;
    status?: 'ok' | 'error';
    since?: string;
    limit?: number;
  } = {}): Promise<RequestLogEntry[]> {
    if (!existsSync(LOG_PATH)) return [];
    const raw = await readFile(LOG_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    let entries: RequestLogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        /* skip corrupt lines */
      }
    }

    if (filters.since) {
      entries = entries.filter((e) => e.ts >= filters.since!);
    }
    if (filters.jurisdiction) {
      entries = entries.filter((e) => e.jurisdiction === filters.jurisdiction);
    }
    if (filters.status === 'error') {
      entries = entries.filter((e) => e.status >= 400);
    } else if (filters.status === 'ok') {
      entries = entries.filter((e) => e.status < 400);
    }

    const limit = filters.limit ?? 50;
    if (entries.length > limit) {
      entries = entries.slice(-limit);
    }
    return entries;
  }

  async stats(since?: string): Promise<{
    total: number;
    errors: number;
    topJurisdictions: Array<{ id: string; count: number }>;
    topRoutes: Array<{ route: string; count: number }>;
    avgDuration_ms: number;
    statusCodes: Record<number, number>;
  }> {
    const entries = await this.query({ since, limit: Infinity });
    const jurisdictionCounts: Record<string, number> = {};
    const routeCounts: Record<string, number> = {};
    const statusCodes: Record<number, number> = {};
    let totalDuration = 0;

    for (const e of entries) {
      if (e.jurisdiction) {
        jurisdictionCounts[e.jurisdiction] =
          (jurisdictionCounts[e.jurisdiction] || 0) + 1;
      }
      const route = e.path.replace(
        /\/jurisdictions\/[^/]+/,
        '/jurisdictions/:id'
      );
      routeCounts[route] = (routeCounts[route] || 0) + 1;
      statusCodes[e.status] = (statusCodes[e.status] || 0) + 1;
      totalDuration += e.duration_ms;
    }

    const topJurisdictions = Object.entries(jurisdictionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));

    const topRoutes = Object.entries(routeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    return {
      total: entries.length,
      errors: entries.filter((e) => e.status >= 400).length,
      topJurisdictions,
      topRoutes,
      avgDuration_ms: entries.length
        ? Math.round(totalDuration / entries.length)
        : 0,
      statusCodes,
    };
  }
}

export const requestLog = new RequestLog();
