import type { CrawlerAdapter } from './crawlers/types.js';
import type { CrawlOptions, CrawlProgress } from './crawlers/pipeline.js';
import { runCrawl } from './crawlers/pipeline.js';

const MAX_QUEUE_SIZE = 10;

type RunCrawlFn = (
  crawler: CrawlerAdapter,
  options: CrawlOptions,
  onProgress?: (progress: CrawlProgress) => void,
) => Promise<CrawlProgress>;

interface QueueEntry {
  jurisdictionId: string;
  resolve: (result: CrawlProgress) => void;
  reject: (error: Error) => void;
  run: () => Promise<CrawlProgress>;
}

/**
 * Global crawl queue. Ensures only 1 crawl runs at a time.
 * Rejects if more than 10 items are queued.
 */
export class CrawlQueue {
  private queue: QueueEntry[] = [];
  private running = false;
  private runFn: RunCrawlFn;

  constructor(runFn: RunCrawlFn = runCrawl) {
    this.runFn = runFn;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  enqueue(
    crawler: CrawlerAdapter,
    options: CrawlOptions,
    onProgress?: (progress: CrawlProgress) => void,
  ): Promise<CrawlProgress> {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(
        new Error(
          `Crawl queue is full (${MAX_QUEUE_SIZE} pending). Try again later.`,
        ),
      );
    }

    return new Promise<CrawlProgress>((resolve, reject) => {
      this.queue.push({
        jurisdictionId: options.jurisdiction.id,
        resolve,
        reject,
        run: () => this.runFn(crawler, options, onProgress),
      });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const entry = this.queue.shift();
    if (!entry) return;

    this.running = true;
    try {
      const result = await entry.run();
      entry.resolve(result);
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
      this.drain();
    }
  }
}

export const crawlQueue = new CrawlQueue();
