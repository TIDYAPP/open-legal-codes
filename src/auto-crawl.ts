import type { RegistryEntry } from './registry/types.js';
import type { Jurisdiction, PublisherInfo } from './types.js';
import { getCrawler } from './crawlers/index.js';
import { runCrawl } from './crawlers/pipeline.js';
import { crawlTracker } from './crawl-tracker.js';
import { store } from './store/index.js';

function registryEntryToJurisdiction(entry: RegistryEntry): Jurisdiction {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    state: entry.state,
    parentId: entry.state ? entry.state.toLowerCase() : null,
    fips: entry.fips,
    publisher: {
      name: entry.publisher as PublisherInfo['name'],
      sourceId: entry.sourceId,
      url: entry.sourceUrl,
    },
    lastCrawled: '',
    lastUpdated: '',
  };
}

/** 30-minute timeout for auto-crawls (large codes like New Orleans ~5700 sections can take 20+ min) */
const AUTO_CRAWL_TIMEOUT_MS = 30 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function triggerAutoCrawl(entry: RegistryEntry): void {
  if (crawlTracker.isActive(entry.id)) return;

  const recentFailure = crawlTracker.getRecentFailure(entry.id);
  if (recentFailure) {
    const cooldownRemaining = Math.round((10 * 60 * 1000 - (Date.now() - recentFailure.failedAt)) / 1000);
    console.log(`[auto-crawl] Skipping ${entry.id} — failed recently (${recentFailure.error}), cooldown ${cooldownRemaining}s remaining`);
    return;
  }

  const jurisdiction = registryEntryToJurisdiction(entry);
  let crawler;
  try {
    crawler = getCrawler(entry.publisher);
  } catch (err: any) {
    console.error(`[auto-crawl] Failed to get crawler for ${entry.publisher}: ${err.message}`);
    return;
  }

  console.log(`[auto-crawl] Starting crawl for ${entry.name} (${entry.id})`);

  withTimeout(runCrawl(crawler, { jurisdiction }), AUTO_CRAWL_TIMEOUT_MS, entry.id)
    .then(() => {
      console.log(`[auto-crawl] Completed crawl for ${entry.name}`);
      store.initialize();
    })
    .catch((err: any) => {
      console.error(`[auto-crawl] Failed crawl for ${entry.name}: ${err.message}`);
      crawlTracker.markFailed(entry.id, err.message);
    });
}
