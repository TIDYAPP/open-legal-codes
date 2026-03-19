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
  /** Crawl only this specific code (if omitted, crawl all codes) */
  codeId?: string;
  /** Publisher-specific code source ID (e.g. Municode productId) */
  codeSourceId?: string;
}

export interface CrawlProgress {
  phase: 'toc' | 'sections' | 'done';
  total: number;
  completed: number;
  currentPath?: string;
  currentCode?: string;
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

  // Discover codes for this jurisdiction
  let codesToCrawl: Array<{ codeId: string; name: string; codeSourceId: string; isPrimary: boolean; sortOrder: number }>;

  if (crawler.listCodes) {
    const discovered = await crawler.listCodes(sourceId);
    // Write code metadata
    writer.writeCodes(jurisdiction.id, discovered.map(c => ({
      codeId: c.codeId,
      name: c.name,
      sourceId: c.sourceId,
      sourceUrl: c.sourceUrl || null,
      lastCrawled: '',
      lastUpdated: '',
      isPrimary: c.isPrimary,
      sortOrder: c.sortOrder,
    })));

    if (options.codeId) {
      const match = discovered.find(c => c.codeId === options.codeId);
      if (!match) {
        throw new Error(`Code '${options.codeId}' not found. Available: ${discovered.map(c => c.codeId).join(', ')}`);
      }
      codesToCrawl = [{ ...match, codeSourceId: match.sourceId }];
    } else if (options.codeSourceId) {
      const match = discovered.find(c => c.sourceId === options.codeSourceId);
      codesToCrawl = match
        ? [{ ...match, codeSourceId: match.sourceId }]
        : [{ codeId: '_default', name: jurisdiction.name, codeSourceId: options.codeSourceId, isPrimary: true, sortOrder: 0 }];
    } else {
      codesToCrawl = discovered.map(c => ({ ...c, codeSourceId: c.sourceId }));
    }
  } else {
    // Crawler doesn't support multi-code — use single default
    const codeId = options.codeId || '_default';
    writer.writeCodes(jurisdiction.id, [{
      codeId,
      name: jurisdiction.name,
      sourceId: null,
      sourceUrl: null,
      lastCrawled: '',
      lastUpdated: '',
      isPrimary: true,
      sortOrder: 0,
    }]);
    codesToCrawl = [{ codeId, name: jurisdiction.name, codeSourceId: options.codeSourceId || sourceId, isPrimary: true, sortOrder: 0 }];
  }

  console.log(`\n[crawl] ${jurisdiction.name}: ${codesToCrawl.length} code(s) to crawl`);

  // Crawl each code sequentially
  for (const code of codesToCrawl) {
    progress.currentCode = code.name;
    console.log(`\n[crawl] Fetching TOC for "${code.name}"...`);
    onProgress?.(progress);
    crawlTracker.updateProgress(jurisdiction.id, progress);

    // Heartbeat: keep tracker alive during long TOC fetches
    const tocHeartbeat = setInterval(() => crawlTracker.updateProgress(jurisdiction.id, progress), 60_000);
    let rawToc: Awaited<ReturnType<typeof crawler.fetchToc>>;
    try {
      rawToc = await crawler.fetchToc(sourceId, code.codeSourceId);
    } finally {
      clearInterval(tocHeartbeat);
    }
    const tocTree = transformToc(rawToc, jurisdiction.id, code.name, code.codeId);

    const contentNodes = flattenContentNodes(tocTree);

    if (contentNodes.length === 0) {
      console.warn(`[crawl] Empty TOC for "${code.name}" (${code.codeSourceId}) — skipping`);
      progress.errors.push({ path: `[${code.codeId}]`, error: 'Empty TOC — no content sections found' });
      continue;
    }

    // Write TOC
    await writer.writeToc(jurisdiction.id, tocTree, code.codeId);
    await writer.writeMeta(jurisdiction.id, {
      id: jurisdiction.id,
      name: jurisdiction.name,
      type: jurisdiction.type,
      state: jurisdiction.state,
      codeName: code.name,
      publisher: jurisdiction.publisher,
    });

    progress.phase = 'sections';
    progress.total += contentNodes.length;
    console.log(`[crawl] "${code.name}": ${contentNodes.length} content sections to fetch`);
    onProgress?.(progress);
    crawlTracker.updateProgress(jurisdiction.id, progress);

    const limit = pLimit(options.concurrency ?? 3);
    const force = options.force ?? false;

    const sectionExists = db.prepare(
      'SELECT 1 FROM sections WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
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
      if (!force && sectionExists.get(jurisdiction.id, code.codeId, node.path)) {
        progress.completed++;
        onProgress?.(progress);
        crawlTracker.updateProgress(jurisdiction.id, progress);
        return;
      }

      try {
        const rawContent = await crawler.fetchSection(sourceId, node.sourceNodeId, code.codeSourceId);

        const pathParts = node.path.split('/');
        const parentPath = pathParts.slice(0, -1).join('/');

        const xml = htmlToUslm(rawContent.html, {
          jurisdictionId: jurisdiction.id,
          parentPath,
          sectionNum: node.num,
          heading: node.heading,
        });

        await writer.writeSection(jurisdiction.id, node.path, xml, rawContent.html, code.codeId);
      } catch (err: any) {
        progress.errors.push({ path: node.path, error: err.message });
      }

      progress.completed++;
      onProgress?.(progress);
      crawlTracker.updateProgress(jurisdiction.id, progress);
    })));

    // Update code's last_crawled timestamp
    const now = new Date().toISOString();
    writer.writeCode(jurisdiction.id, {
      codeId: code.codeId,
      name: code.name,
      sourceId: code.codeSourceId,
      sourceUrl: null,
      lastCrawled: now,
      lastUpdated: now,
      isPrimary: code.isPrimary,
      sortOrder: code.sortOrder,
    });
  }

  // Update jurisdiction registry (only if at least some sections succeeded)
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
