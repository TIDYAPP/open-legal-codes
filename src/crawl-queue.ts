import type { CrawlerAdapter } from './crawlers/types.js';
import type { CrawlOptions, CrawlProgress } from './crawlers/pipeline.js';
import { runCrawl } from './crawlers/pipeline.js';

const MAX_QUEUE_SIZE = 10; // max waiting (not counting active slots)
const MAX_CONCURRENT = 5;  // max simultaneous crawls

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
 * Global crawl queue. Runs up to MAX_CONCURRENT crawls in parallel.
 * Queues additional requests up to MAX_QUEUE_SIZE waiting; rejects beyond that.
 */
export class CrawlQueue {
  private queue: QueueEntry[] = [];
  private activeCount = 0;
  private runFn: RunCrawlFn;

  constructor(runFn: RunCrawlFn = runCrawl) {
    this.runFn = runFn;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.activeCount > 0;
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

  private drain(): void {
    while (this.activeCount < MAX_CONCURRENT) {
      const entry = this.queue.shift();
      if (!entry) return;

      this.activeCount++;
      entry.run().then(
        (result) => { this.activeCount--; entry.resolve(result); this.drain(); },
        (err) => { this.activeCount--; entry.reject(err instanceof Error ? err : new Error(String(err))); this.drain(); },
      );
    }
  }
}

export const crawlQueue = new CrawlQueue();
