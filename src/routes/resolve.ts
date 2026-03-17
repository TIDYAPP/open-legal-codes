/**
 * Shared jurisdiction resolver for content routes (code, toc, search).
 * Collapses the duplicated "check cache → registry → auto-crawl → 202/404" pattern.
 */

import type { Context } from 'hono';
import type { Jurisdiction } from '../types.js';
import { store } from '../store/index.js';
import { crawlTracker } from '../crawl-tracker.js';
import { registryStore } from '../registry/store.js';
import { triggerAutoCrawl } from '../auto-crawl.js';

export type ResolveResult =
  | { status: 'cached'; jurisdiction: Jurisdiction }
  | { status: 'crawling'; id: string; progress: { phase: string; total: number; completed: number }; startedAt: string }
  | { status: 'failed'; id: string; error: string }
  | { status: 'not_found' };

/** Resolve a jurisdiction by ID: check cache, check crawl status, check registry + auto-crawl. */
export function resolveJurisdiction(id: string): ResolveResult {
  const jurisdiction = store.getJurisdiction(id);
  if (jurisdiction) {
    return { status: 'cached', jurisdiction };
  }

  // Already crawling?
  const crawlStatus = crawlTracker.getStatus(id);
  if (crawlStatus) {
    return {
      status: 'crawling',
      id,
      progress: { phase: crawlStatus.progress.phase, total: crawlStatus.progress.total, completed: crawlStatus.progress.completed },
      startedAt: crawlStatus.startedAt,
    };
  }

  // Known in registry? Check for recent failure before triggering.
  const entry = registryStore.getById(id);
  if (entry) {
    const recentFailure = crawlTracker.getRecentFailure(id);
    if (recentFailure) {
      return { status: 'failed', id, error: recentFailure.error };
    }

    triggerAutoCrawl(entry);
    const crawlStatus2 = crawlTracker.getStatus(id);
    return {
      status: 'crawling',
      id,
      progress: crawlStatus2
        ? { phase: crawlStatus2.progress.phase, total: crawlStatus2.progress.total, completed: crawlStatus2.progress.completed }
        : { phase: 'toc', total: 0, completed: 0 },
      startedAt: crawlStatus2?.startedAt || new Date().toISOString(),
    };
  }

  return { status: 'not_found' };
}

/** Return a 202 response for a crawling jurisdiction. */
export function crawlingResponse(c: Context, result: Extract<ResolveResult, { status: 'crawling' }>) {
  return c.json(
    {
      status: 'CRAWL_IN_PROGRESS',
      message: `Data for '${result.id}' is being fetched.`,
      progress: result.progress,
      startedAt: result.startedAt,
      retryAfter: 30,
    },
    202,
  );
}

/** Return a 503 response for a recently-failed crawl. */
export function failedResponse(c: Context, result: Extract<ResolveResult, { status: 'failed' }>) {
  return c.json(
    { error: { code: 'CRAWL_FAILED', message: `Crawl for '${result.id}' failed: ${result.error}. Retry after cooldown.` } },
    503,
  );
}

/** Return a 404 response for a jurisdiction or path not found. */
export function notFoundResponse(c: Context, message: string) {
  return c.json(
    { error: { code: 'NOT_FOUND', message } },
    404,
  );
}

/** Return 202 if a crawl is active for this jurisdiction, otherwise 404.
 *  Used when the jurisdiction is cached but specific content isn't found yet. */
export function notFoundOrCrawling(c: Context, id: string, message: string) {
  const status = crawlTracker.getStatus(id);
  if (status) {
    return crawlingResponse(c, {
      status: 'crawling',
      id,
      progress: { phase: status.progress.phase, total: status.progress.total, completed: status.progress.completed },
      startedAt: status.startedAt,
    });
  }
  return notFoundResponse(c, message);
}
