import type { CrawlProgress } from './crawlers/pipeline.js';

/** Auto-clean crawls older than this with no progress (ms) */
const STALE_TIMEOUT_MS = 35 * 60 * 1000; // 35 minutes (matches auto-crawl timeout + buffer)

/** Failed crawl cooldown — suppress re-trigger attempts for this long */
const FAILED_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export interface CrawlStatus {
  jurisdictionId: string;
  startedAt: string;
  lastUpdated: number; // Date.now() timestamp for staleness checks
  progress: CrawlProgress;
}

/**
 * Tracks which jurisdictions currently have an active crawl running.
 * Routes check this to return 202 instead of 404 when data isn't cached yet.
 * Automatically cleans up stale entries that have been stuck too long.
 * Failed crawls are remembered for a cooldown period to prevent immediate retry loops.
 */
class CrawlTracker {
  private active: Map<string, CrawlStatus> = new Map();
  private failed: Map<string, { failedAt: number; error: string }> = new Map();

  start(jurisdictionId: string): void {
    this.failed.delete(jurisdictionId); // Clear any prior failure on fresh start
    this.active.set(jurisdictionId, {
      jurisdictionId,
      startedAt: new Date().toISOString(),
      lastUpdated: Date.now(),
      progress: { phase: 'toc', total: 0, completed: 0, errors: [] },
    });
  }

  updateProgress(jurisdictionId: string, progress: CrawlProgress): void {
    const status = this.active.get(jurisdictionId);
    if (status) {
      status.progress = { ...progress };
      status.lastUpdated = Date.now();
    }
  }

  finish(jurisdictionId: string): void {
    this.active.delete(jurisdictionId);
  }

  /** Mark a crawl as failed — suppresses re-trigger for FAILED_COOLDOWN_MS */
  markFailed(jurisdictionId: string, error: string): void {
    this.active.delete(jurisdictionId);
    this.failed.set(jurisdictionId, { failedAt: Date.now(), error });
    console.warn(`[crawl-tracker] Marked ${jurisdictionId} as failed: ${error}`);
  }

  /** Returns the recent failure if within cooldown window, undefined otherwise */
  getRecentFailure(jurisdictionId: string): { failedAt: number; error: string } | undefined {
    const failure = this.failed.get(jurisdictionId);
    if (!failure) return undefined;
    if (Date.now() - failure.failedAt > FAILED_COOLDOWN_MS) {
      this.failed.delete(jurisdictionId);
      return undefined;
    }
    return failure;
  }

  getStatus(jurisdictionId: string): CrawlStatus | undefined {
    const status = this.active.get(jurisdictionId);
    if (!status) return undefined;

    // Auto-clean stale crawls that have been stuck too long
    if (Date.now() - status.lastUpdated > STALE_TIMEOUT_MS) {
      console.warn(`[crawl-tracker] Cleaning stale crawl for ${jurisdictionId} (no progress for ${Math.round((Date.now() - status.lastUpdated) / 1000)}s)`);
      this.active.delete(jurisdictionId);
      return undefined;
    }

    return status;
  }

  isActive(jurisdictionId: string): boolean {
    // Use getStatus so staleness check runs
    return this.getStatus(jurisdictionId) !== undefined;
  }
}

export const crawlTracker = new CrawlTracker();
