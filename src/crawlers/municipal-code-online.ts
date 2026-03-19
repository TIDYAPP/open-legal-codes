import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { StagehandClient } from './stagehand-client.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Municipal Code Online (municipalcodeonline.com) Crawler Adapter
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: This adapter MUST use Browserbase + Stagehand.      ║
 * ║  NEVER use plain HTTP, fetch, BrowserbaseHttpClient, etc.      ║
 * ║  This is an AngularJS SPA — plain HTTP returns empty shells.   ║
 * ║  If Stagehand breaks, FIX STAGEHAND. Do NOT switch to HTTP.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * sourceId is the subdomain prefix (e.g., "parkcity" for parkcity.municipalcodeonline.com)
 */
export class MunicipalCodeOnlineCrawler implements CrawlerAdapter {
  readonly publisherName = 'municipal-code-online' as const;
  private client: StagehandClient;

  constructor() {
    this.client = new StagehandClient({ minDelayMs: 2000 });
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const dataDir = join(process.cwd(), 'data');
    const knownPath = join(dataDir, 'municipal-code-online-known.json');
    let known: { name: string; state: string; slug: string; fips?: string; type?: 'city' | 'county' }[];
    try {
      known = JSON.parse(readFileSync(knownPath, 'utf-8'));
    } catch {
      console.warn('[municipal-code-online] No known list found');
      return;
    }

    if (state) {
      known = known.filter(j => j.state.toUpperCase() === state.toUpperCase());
    }

    for (const j of known) {
      const idSlug = j.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      yield {
        id: `${j.state.toLowerCase()}-${idSlug}`,
        name: `${j.name}, ${j.state}`,
        type: j.type || 'city',
        state: j.state.toUpperCase(),
        parentId: j.state.toLowerCase(),
        fips: j.fips || null,
        publisher: {
          name: 'municipal-code-online' as const,
          sourceId: j.slug,
          url: `https://${j.slug}.municipalcodeonline.com/book?type=ordinances`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const url = `https://${sourceId}.municipalcodeonline.com/book?type=ordinances`;
    console.log(`[municipal-code-online] Fetching TOC from ${url}`);

    // Navigate via Stagehand — establishes the session cookie
    const page = await this.client.navigate(url);

    // Wait for the Kendo TreeView to render — AngularJS SPAs can be slow to bootstrap
    let treeFound = false;
    for (let attempt = 0; attempt < 3 && !treeFound; attempt++) {
      try {
        await page.waitForSelector('.k-treeview, [data-role="treeview"], .k-group, .k-item', { timeout: 10000 });
        treeFound = true;
      } catch {
        console.log(`[municipal-code-online] TreeView not found (attempt ${attempt + 1}/3), waiting...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Extract the tree structure from the Kendo TreeView DOM
    const treeData = await page.evaluate(() => {
      interface TreeNode {
        id: string;
        text: string;
        hasChildren: boolean;
        children: TreeNode[];
      }

      function extractNodes(container: Element): TreeNode[] {
        const nodes: TreeNode[] = [];
        const items = container.querySelectorAll(':scope > .k-item, :scope > li');

        for (const item of items) {
          const textEl = item.querySelector(':scope > .k-in, :scope > div > .k-in, :scope > span > .k-in');
          const text = textEl?.textContent?.trim() || '';
          if (!text) continue;

          const uid = item.getAttribute('data-uid') || '';
          const id = uid || text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

          const childGroup = item.querySelector(':scope > .k-group, :scope > ul.k-group');
          const hasChildren = !!childGroup || item.classList.contains('k-item') && !!item.querySelector('.k-icon.k-plus, .k-icon.k-i-expand');

          const node: TreeNode = { id, text, hasChildren, children: [] };

          if (childGroup) {
            node.children = extractNodes(childGroup);
          }

          nodes.push(node);
        }
        return nodes;
      }

      const treeView = document.querySelector('.k-treeview .k-group, [data-role="treeview"] .k-group, .k-treeview > ul');
      if (!treeView) return [];
      return extractNodes(treeView);
    });

    if (treeData.length > 0) {
      console.log(`[municipal-code-online] Extracted ${treeData.length} top-level nodes from Kendo TreeView`);
      return this.transformTreeData(treeData);
    }

    throw new Error(`Could not extract TOC from ${url}. The page may require interaction to expand the tree.`);
  }

  private transformTreeData(
    nodes: { id: string; text: string; hasChildren: boolean; children: any[] }[],
  ): RawTocNode[] {
    return nodes.map(node => ({
      id: node.id,
      title: node.text,
      level: guessLevel(node.text, node.hasChildren),
      hasContent: !node.hasChildren || node.children.length === 0,
      children: node.children.length > 0
        ? this.transformTreeData(node.children)
        : [],
    }));
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const url = `https://${sourceId}.municipalcodeonline.com/book?type=ordinances&name=${encodeURIComponent(sectionId)}`;
    console.log(`[municipal-code-online] Fetching section ${sectionId}`);

    const page = await this.client.navigate(url);

    // Poll for actual content — the AngularJS app loads content asynchronously into #contents/#docs
    let contentHtml = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      contentHtml = await page.evaluate(() => {
        // Check for loaded content in the right pane
        const contentsDiv = document.querySelector('#contents');
        if (contentsDiv && contentsDiv.innerHTML.trim().length > 100) {
          return contentsDiv.innerHTML;
        }
        const docsDiv = document.querySelector('#docs');
        if (docsDiv && docsDiv.innerHTML.trim().length > 100) {
          return docsDiv.innerHTML;
        }
        // Fallback: second k-pane if it has real content (not just loading spinner)
        const panes = document.querySelectorAll('.k-pane');
        if (panes.length >= 2) {
          const rightPane = panes[panes.length - 1];
          const text = rightPane.textContent || '';
          // Skip if it's just the loading spinner
          if (text.trim().length > 100 && !text.includes('k-loading-image')) {
            return rightPane.innerHTML;
          }
        }
        return '';
      }) as string;

      if (contentHtml.trim().length > 100) break;
      // Wait for async content load
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!contentHtml.trim()) {
      throw new Error(`Empty content for section ${sectionId} from ${sourceId}.municipalcodeonline.com`);
    }

    return {
      html: contentHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

function guessLevel(title: string, hasChildren: boolean): string {
  const t = title.toLowerCase();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('chapter ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('section ') || t.startsWith('sec.') || t.startsWith('§') || /^\d/.test(t)) return 'section';
  return hasChildren ? 'chapter' : 'section';
}
