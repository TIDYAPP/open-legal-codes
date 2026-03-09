import type { CrawlProgress } from './crawlers/pipeline.js';

export interface CrawlStatus {
  jurisdictionId: string;
  startedAt: string;
  progress: CrawlProgress;
}

/**
 * Tracks which jurisdictions currently have an active crawl running.
 * Routes check this to return 202 instead of 404 when data isn't cached yet.
 */
class CrawlTracker {
  private active: Map<string, CrawlStatus> = new Map();

  start(jurisdictionId: string): void {
    this.active.set(jurisdictionId, {
      jurisdictionId,
      startedAt: new Date().toISOString(),
      progress: { phase: 'toc', total: 0, completed: 0, errors: [] },
    });
  }

  updateProgress(jurisdictionId: string, progress: CrawlProgress): void {
    const status = this.active.get(jurisdictionId);
    if (status) {
      status.progress = { ...progress };
    }
  }

  finish(jurisdictionId: string): void {
    this.active.delete(jurisdictionId);
  }

  getStatus(jurisdictionId: string): CrawlStatus | undefined {
    return this.active.get(jurisdictionId);
  }

  isActive(jurisdictionId: string): boolean {
    return this.active.has(jurisdictionId);
  }
}

export const crawlTracker = new CrawlTracker();
