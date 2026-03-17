import { describe, it, expect, vi } from 'vitest';
import { CrawlQueue } from '../crawl-queue.js';
import type { CrawlProgress } from '../crawlers/pipeline.js';
import type { CrawlerAdapter } from '../crawlers/types.js';
import type { Jurisdiction } from '../types.js';

const fakeJurisdiction = (id: string): Jurisdiction => ({
  id,
  name: `Test ${id}`,
  type: 'city',
  state: 'CA',
  parentId: null,
  fips: null,
  publisher: { name: 'municode', sourceId: '123', url: 'https://example.com' },
  lastCrawled: '',
  lastUpdated: '',
});

const fakeCrawler = {} as CrawlerAdapter;

const doneProgress: CrawlProgress = {
  phase: 'done',
  total: 10,
  completed: 10,
  errors: [],
};

describe('CrawlQueue', () => {
  it('runs a single crawl', async () => {
    const runFn = vi.fn().mockResolvedValueOnce(doneProgress);
    const queue = new CrawlQueue(runFn);

    const result = await queue.enqueue(fakeCrawler, {
      jurisdiction: fakeJurisdiction('test-1'),
    });

    expect(result).toEqual(doneProgress);
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it('runs up to 5 crawls concurrently, queues the rest', async () => {
    const order: string[] = [];
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });

    const runFn = vi.fn().mockImplementation(async (_crawler, options) => {
      const id = options.jurisdiction.id;
      order.push(`start-${id}`);
      await blocker;
      order.push(`end-${id}`);
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    // Enqueue 6 crawls — first 5 should start immediately, 6th should wait
    const promises = Array.from({ length: 6 }, (_, i) =>
      queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction(`j-${i}`) }),
    );

    await new Promise((r) => setTimeout(r, 0));

    // First 5 should have started, 6th should be queued
    expect(order.filter(e => e.startsWith('start'))).toHaveLength(5);
    expect(queue.queueLength).toBe(1);

    unblock();
    await Promise.all(promises);

    // All 6 ran
    expect(runFn).toHaveBeenCalledTimes(6);
  });

  it('rejects when queue is full (>10 waiting)', async () => {
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });
    const runFn = vi.fn().mockImplementation(async () => {
      await blocker;
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    // 5 running + 10 waiting = 15 total
    const promises: Promise<CrawlProgress>[] = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction(`j-${i}`) }),
      );
    }

    // 16th should be rejected (queue waiting slots are full)
    await expect(
      queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('overflow') }),
    ).rejects.toThrow(/queue is full/i);

    unblock();
    await Promise.allSettled(promises);
  });

  it('continues processing after a failed crawl', async () => {
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('publisher down'))
      .mockResolvedValueOnce(doneProgress);
    const queue = new CrawlQueue(runFn);

    const p1 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('fail') });
    const p2 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('ok') });

    await expect(p1).rejects.toThrow('publisher down');
    const result = await p2;
    expect(result).toEqual(doneProgress);
  });

  it('passes onProgress callback through', async () => {
    const runFn = vi.fn().mockResolvedValueOnce(doneProgress);
    const queue = new CrawlQueue(runFn);
    const onProgress = vi.fn();

    await queue.enqueue(
      fakeCrawler,
      { jurisdiction: fakeJurisdiction('test') },
      onProgress,
    );

    expect(runFn).toHaveBeenCalledWith(
      fakeCrawler,
      { jurisdiction: fakeJurisdiction('test') },
      onProgress,
    );
  });

  it('reports queue length and isRunning correctly', async () => {
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });
    const runFn = vi.fn().mockImplementation(async () => {
      await blocker;
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    expect(queue.queueLength).toBe(0);
    expect(queue.isRunning).toBe(false);

    // Fill all 5 concurrent slots
    const running = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction(`r-${i}`) }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.isRunning).toBe(true);

    // One more goes to the waiting queue
    const p6 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('queued') });
    expect(queue.queueLength).toBe(1);

    unblock();
    await Promise.all([...running, p6]);
    expect(queue.queueLength).toBe(0);
    expect(queue.isRunning).toBe(false);
  });
});
