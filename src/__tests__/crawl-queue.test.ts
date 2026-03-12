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

  it('serializes concurrent crawls (1 at a time)', async () => {
    const order: string[] = [];
    const runFn = vi.fn().mockImplementation(async (_crawler, options) => {
      const id = options.jurisdiction.id;
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${id}`);
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    const p1 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('a') });
    const p2 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('b') });

    await Promise.all([p1, p2]);

    // b should not start until a ends
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });

  it('rejects when queue is full (>10 pending)', async () => {
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });
    const runFn = vi.fn().mockImplementation(async () => {
      await blocker;
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    // 1 running + 10 queued = 11 total
    const promises: Promise<CrawlProgress>[] = [];
    for (let i = 0; i < 11; i++) {
      promises.push(
        queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction(`j-${i}`) }),
      );
    }

    // 12th should be rejected
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

  it('reports queue length correctly', async () => {
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });
    const runFn = vi.fn().mockImplementation(async () => {
      await blocker;
      return doneProgress;
    });
    const queue = new CrawlQueue(runFn);

    expect(queue.queueLength).toBe(0);
    expect(queue.isRunning).toBe(false);

    const p1 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('a') });
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.isRunning).toBe(true);

    const p2 = queue.enqueue(fakeCrawler, { jurisdiction: fakeJurisdiction('b') });
    expect(queue.queueLength).toBe(1);

    unblock();
    await Promise.all([p1, p2]);
    expect(queue.queueLength).toBe(0);
    expect(queue.isRunning).toBe(false);
  });
});
