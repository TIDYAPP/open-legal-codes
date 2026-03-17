import { join } from 'node:path';
import type { CrawlerAdapter } from './types.js';
import type { Jurisdiction, TocNode } from '../types.js';
import { transformToc, flattenContentNodes } from './toc-transformer.js';
import { htmlToUslm } from '../converter/html-to-uslm.js';
import { CodeWriter } from '../store/writer.js';
import { crawlTracker } from '../crawl-tracker.js';

export interface CrawlOptions {
  jurisdiction: Jurisdiction;
  codesDir?: string;
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
  const codesDir = options.codesDir || join(process.cwd(), 'codes');
  const writer = new CodeWriter(codesDir);
  const jurisdiction = options.jurisdiction;
  const sourceId = jurisdiction.publisher.sourceId;

  const progress: CrawlProgress = {
    phase: 'toc',
    total: 0,
    completed: 0,
    errors: [],
  };

  // Register active crawl
  crawlTracker.start(jurisdiction.id);

  // Phase 1: Fetch TOC
  console.log(`\n[crawl] Fetching TOC for ${jurisdiction.name}...`);
  onProgress?.(progress);
  crawlTracker.updateProgress(jurisdiction.id, progress);

  const rawToc = await crawler.fetchToc(sourceId);
  const tocTree = transformToc(rawToc, jurisdiction.id, jurisdiction.name);

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

  // Phase 2: Fetch sections
  const contentNodes = flattenContentNodes(tocTree);
  progress.phase = 'sections';
  progress.total = contentNodes.length;
  console.log(`[crawl] Found ${contentNodes.length} content sections to fetch`);

  if (contentNodes.length === 0) {
    console.warn(`[crawl] Warning: TOC for ${jurisdiction.name} has zero content sections — structure cached but no section content available`);
    progress.errors.push({ path: '', error: 'TOC contains zero content sections' });
  }
  onProgress?.(progress);
  crawlTracker.updateProgress(jurisdiction.id, progress);

  for (const node of contentNodes) {
    progress.currentPath = node.path;

    if (!node.sourceNodeId) {
      progress.errors.push({ path: node.path, error: 'Missing sourceNodeId' });
      progress.completed++;
      continue;
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
  }

  // Phase 3: Update registry
  const now = new Date().toISOString();
  await writer.updateRegistry({
    ...jurisdiction,
    lastCrawled: now,
    lastUpdated: now,
  });

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
