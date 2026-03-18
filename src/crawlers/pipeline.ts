import pLimit from 'p-limit';
import type { CrawlerAdapter } from './types.js';
import type { Jurisdiction } from '../types.js';
import { transformToc, flattenContentNodes } from './toc-transformer.js';
import { htmlToUslm } from '../converter/html-to-uslm.js';
import { CodeWriter } from '../store/writer.js';
import { getDb } from '../store/db.js';
import { crawlTracker } from '../crawl-tracker.js';

export interface CrawlOptions {
  jurisdiction: Jurisdiction;
  /** @deprecated No longer used — data is stored in SQLite */
  codesDir?: string;
  /** Max concurrent section fetches (default: 5) */
  concurrency?: number;
  /** Re-fetch sections even if already cached (default: false) */
  force?: boolean;
}

export interface CrawlProgress {
  phase: 'toc' | 'sections' | 'done';
  total: number;
  completed: number;
  currentPath?: string;
  errors: Array<{ path: string; error: string }>;
}

export async function runCrawl(
  crawler: CrawlerAdapter,
  options: CrawlOptions,
  onProgress?: (progress: CrawlProgress) => void,
): Promise<CrawlProgress> {
  const db = getDb();
  const writer = new CodeWriter(db);
  const jurisdiction = options.jurisdiction;
  const sourceId = jurisdiction.publisher.sourceId;

  const progress: CrawlProgress = {
    phase: 'toc',
    total: 0,
    completed: 0,
    errors: [],
  };

  // Ensure jurisdiction row exists before writing TOC/sections (FK constraints)
  await writer.updateRegistry(jurisdiction);

  // Register active crawl
  crawlTracker.start(jurisdiction.id);

  // Phase 1: Fetch TOC
  console.log(`\n[crawl] Fetching TOC for ${jurisdiction.name}...`);
  onProgress?.(progress);
  crawlTracker.updateProgress(jurisdiction.id, progress);

  // Heartbeat: keep tracker alive during long TOC fetches so stale-cleanup doesn't fire
  const tocHeartbeat = setInterval(() => crawlTracker.updateProgress(jurisdiction.id, progress), 60_000);
  let rawToc: Awaited<ReturnType<typeof crawler.fetchToc>>;
  try {
    rawToc = await crawler.fetchToc(sourceId);
  } finally {
    clearInterval(tocHeartbeat);
  }
  const tocTree = transformToc(rawToc, jurisdiction.id, jurisdiction.name);

  // Phase 2: Fetch sections
  const contentNodes = flattenContentNodes(tocTree);

  // Guard: reject empty TOC before writing anything so we don't cache a bad result.
  if (contentNodes.length === 0) {
    throw new Error(`Empty TOC for ${jurisdiction.name} (${sourceId}) — no content sections found, aborting to prevent bad cache entry`);
  }

  // Write TOC and meta
  await writer.writeToc(jurisdiction.id, tocTree);
  await writer.writeMeta(jurisdiction.id, {
    id: jurisdiction.id,
    name: jurisdiction.name,
    type: jurisdiction.type,
    state: jurisdiction.state,
    codeName: jurisdiction.name,
    publisher: jurisdiction.publisher,
  });

  progress.phase = 'sections';
  progress.total = contentNodes.length;
  console.log(`[crawl] Found ${contentNodes.length} content sections to fetch`);
  onProgress?.(progress);
  crawlTracker.updateProgress(jurisdiction.id, progress);

  const limit = pLimit(options.concurrency ?? 3);
  const force = options.force ?? false;

  // Prepared statement to check if section already exists in DB
  const sectionExists = db.prepare(
    'SELECT 1 FROM sections WHERE jurisdiction_id = ? AND path = ?'
  );

  await Promise.all(contentNodes.map((node) => limit(async () => {
    progress.currentPath = node.path;

    if (!node.sourceNodeId) {
      progress.errors.push({ path: node.path, error: 'Missing sourceNodeId' });
      progress.completed++;
      onProgress?.(progress);
      crawlTracker.updateProgress(jurisdiction.id, progress);
      return;
    }

    // Skip sections already in DB (unless force re-crawl)
    if (!force && sectionExists.get(jurisdiction.id, node.path)) {
      progress.completed++;
      onProgress?.(progress);
      crawlTracker.updateProgress(jurisdiction.id, progress);
      return;
    }

    try {
      const rawContent = await crawler.fetchSection(sourceId, node.sourceNodeId);

      // Determine parent path (everything up to the last segment)
      const pathParts = node.path.split('/');
      const parentPath = pathParts.slice(0, -1).join('/');

      const xml = htmlToUslm(rawContent.html, {
        jurisdictionId: jurisdiction.id,
        parentPath,
        sectionNum: node.num,
        heading: node.heading,
      });

      await writer.writeSection(jurisdiction.id, node.path, xml, rawContent.html);
    } catch (err: any) {
      progress.errors.push({ path: node.path, error: err.message });
    }

    progress.completed++;
    onProgress?.(progress);
    crawlTracker.updateProgress(jurisdiction.id, progress);
  })));

  // Phase 3: Update registry (only if at least some sections succeeded)
  const successCount = progress.completed - progress.errors.length;
  if (successCount > 0) {
    const now = new Date().toISOString();
    await writer.updateRegistry({
      ...jurisdiction,
      lastCrawled: now,
      lastUpdated: now,
    });
  } else if (progress.errors.length > 0) {
    console.warn(`[crawl] All ${progress.errors.length} sections failed for ${jurisdiction.name} — not marking as cached`);
    throw new Error(`Crawl failed: all ${progress.errors.length} section fetches failed for ${jurisdiction.name}`);
  }

  progress.phase = 'done';
  onProgress?.(progress);
  crawlTracker.finish(jurisdiction.id);

  // Clean up resources (e.g., Browserbase sessions)
  if (typeof (crawler as any).dispose === 'function') {
    await (crawler as any).dispose();
  }

  console.log(`\n[crawl] Done. ${progress.completed} sections, ${progress.errors.length} errors.`);
  return progress;
}
