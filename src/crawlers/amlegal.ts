import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { StagehandClient } from './stagehand-client.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE_BASE = 'https://codelibrary.amlegal.com';

/**
 * American Legal Publishing Crawler Adapter
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: This adapter MUST use Browserbase + Stagehand.      ║
 * ║  NEVER use plain HTTP, fetch, axios, BrowserbaseHttpClient,    ║
 * ║  FallbackHttpClient, or cheerio for AMLegal.                   ║
 * ║  AMLegal is a React SPA behind Cloudflare.                     ║
 * ║  If Stagehand breaks, FIX STAGEHAND. Do NOT switch to HTTP.    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
export class AmlegalCrawler implements CrawlerAdapter {
  readonly publisherName = 'amlegal' as const;
  private client: StagehandClient;

  constructor() {
    // ALWAYS use Browserbase + Stagehand — AMLegal is behind Cloudflare and is a React SPA.
    // NEVER use plain HTTP, BrowserbaseHttpClient, or FallbackHttpClient for this publisher.
    this.client = new StagehandClient({ minDelayMs: 2000 });
  }

  async dispose(): Promise<void> {
    await this.client.dispose();
  }

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const dataDir = join(process.cwd(), 'data');
    const knownPath = join(dataDir, 'amlegal-known.json');
    let known: { name: string; state: string; slug: string; fips?: string; type?: 'city' | 'county' }[];
    try {
      known = JSON.parse(readFileSync(knownPath, 'utf-8'));
    } catch {
      console.warn('[amlegal] No amlegal-known.json found');
      return;
    }

    if (state) {
      known = known.filter(j => j.state.toUpperCase() === state.toUpperCase());
    }

    for (const j of known) {
      const slug = j.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      yield {
        id: `${j.state.toLowerCase()}-${slug}`,
        name: `${j.name}, ${j.state}`,
        type: j.type || 'city',
        state: j.state.toUpperCase(),
        parentId: j.state.toLowerCase(),
        fips: j.fips || null,
        publisher: {
          name: 'amlegal' as const,
          sourceId: j.slug,
          url: `${SITE_BASE}/codes/${j.slug}/latest/overview`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const url = `${SITE_BASE}/codes/${sourceId}/latest/overview`;
    console.log(`[amlegal] Fetching TOC from ${url}`);

    // Navigate via Stagehand (Browserbase cloud browser)
    const page = await this.client.navigate(url);

    // Poll for TOC links — React SPA may take several seconds to render
    let tocData: { id: string; title: string; href: string; level: string }[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      tocData = await page.evaluate(() => {
        const entries: { id: string; title: string; href: string; level: string }[] = [];
        const links = document.querySelectorAll('a[href*="/codes/"]');

        for (const link of links) {
          const href = (link as HTMLAnchorElement).href || link.getAttribute('href') || '';
          const text = link.textContent?.trim() || '';
          if (!text || text.length < 2) continue;

          // Match /codes/{sourceId}/latest/{codeSlug}/{docId}
          const match = href.match(/\/codes\/[^/]+\/latest\/([^/]+)\/([^/?#]+)/);
          if (!match) continue;

          const [, codeSlug, docId] = match;
          if (docId === 'overview' || docId === 'search') continue;

          entries.push({
            id: `${codeSlug}/${docId}`,
            title: text,
            href,
            level: codeSlug,
          });
        }

        return entries;
      });

      if (tocData.length > 0) break;

      // Debug: log what links ARE on the page
      if (attempt === 0) {
        const debug = await page.evaluate(() => {
          const allLinks = document.querySelectorAll('a');
          const hrefs = Array.from(allLinks).slice(0, 20).map(a => ({
            href: a.getAttribute('href') || a.href || '',
            text: (a.textContent || '').trim().slice(0, 60)
          })).filter(l => l.text.length > 2);
          return JSON.stringify(hrefs);
        });
        console.log(`[amlegal] Debug: sample links on page: ${debug}`);
      }

      console.log(`[amlegal] No TOC links found yet (attempt ${attempt + 1}/5), waiting for React...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // Group by code slug
    const codeGroups = new Map<string, RawTocNode>();
    for (const entry of tocData) {
      const codeSlug = entry.level;
      if (!codeGroups.has(codeSlug)) {
        codeGroups.set(codeSlug, {
          id: codeSlug,
          title: codeSlug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          level: 'title',
          hasContent: false,
          children: [],
        });
      }

      const existing = codeGroups.get(codeSlug)!.children;
      if (!existing.some(c => c.id === entry.id)) {
        existing.push({
          id: entry.id,
          title: entry.title,
          level: guessLevelFromTitle(entry.title),
          hasContent: true,
          children: [],
        });
      }
    }

    const result = Array.from(codeGroups.values());
    const totalSections = result.reduce((n, c) => n + c.children.length, 0);
    console.log(`[amlegal] Extracted ${result.length} codes with ${totalSections} sections from DOM`);

    if (totalSections === 0) {
      // Fallback: try Redux state from HTML
      const html = await this.client.getRenderedHtml();
      const state = extractReduxState(html);
      if (state?.codes?.selectedVersion?.toc) {
        const version = state.codes.selectedVersion;
        const reduxResult: RawTocNode[] = [];
        for (const code of version.toc) {
          const codeNode: RawTocNode = {
            id: code.slug || code.uuid || String(code.id),
            title: code.title,
            level: 'title',
            hasContent: false,
            children: [],
          };
          if (code.sections && Array.isArray(code.sections)) {
            for (const section of code.sections) {
              codeNode.children.push(this.transformSection(section, code.slug));
            }
          }
          reduxResult.push(codeNode);
        }
        console.log(`[amlegal] Extracted ${reduxResult.length} codes from Redux state`);
        return reduxResult;
      }

      console.log(`[amlegal] HTML length: ${html.length}, no TOC entries found`);
    }

    return result;
  }

  private transformSection(section: AmlegalSection, codeSlug: string): RawTocNode {
    const docId = section.doc_id || String(section.id);
    return {
      id: `${codeSlug}/${docId}`,
      title: section.title || `Section ${docId}`,
      level: guessLevel(section),
      hasContent: true,
      children: [],
    };
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const [codeSlug, docId] = sectionId.split('/', 2);
    if (!codeSlug || !docId) {
      throw new Error(`Invalid sectionId format: "${sectionId}". Expected "code_slug/doc_id"`);
    }

    const url = `${SITE_BASE}/codes/${sourceId}/latest/${codeSlug}/${docId}`;
    console.log(`[amlegal] Fetching section ${sectionId}`);

    // Navigate via Stagehand (Browserbase cloud browser)
    const page = await this.client.navigate(url);

    // Poll for content — React SPA may take time to render section content
    let contentHtml = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      contentHtml = await page.evaluate(() => {
        // AMLegal content selectors — ordered from most specific to least
        const selectors = [
          '.codenav__section-body',  // Current AMLegal site structure
          '.codenav__right',         // Fallback: right content pane
          '.akn-act',
          '.codes-content',
          '.code-content',
          '[class*="CodeContent"]',
          'article',
          'main',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerHTML.trim().length > 50) {
            return el.innerHTML;
          }
        }

        return '';
      });

      if (contentHtml.trim()) break;
      await new Promise(r => setTimeout(r, 3000));
    }

    // Fallback: try Redux state
    if (!contentHtml.trim()) {
      const html = await this.client.getRenderedHtml();
      const state = extractReduxState(html);
      if (state?.sections?.items && Array.isArray(state.sections.items)) {
        const matching = state.sections.items.find(
          (item: any) => item.doc_id === docId || String(item.id) === docId
        );
        contentHtml = matching?.html || state.sections.items.map((item: any) => item.html || '').join('\n');
      }
    }

    contentHtml = cleanAmlegalHtml(contentHtml);

    if (!contentHtml.trim()) {
      throw new Error(
        `Empty content for section ${sectionId} — AMLegal may be blocking requests. URL: ${url}`,
      );
    }

    return {
      html: contentHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

// --- Helpers ---

interface AmlegalSection {
  id: number | string;
  doc_id?: string;
  title?: string;
  level?: string;
  type?: string;
}

/** Strip React components and clean up AMLegal HTML */
function cleanAmlegalHtml(html: string): string {
  return html
    // Remove embedded style and script blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove React components
    .replace(/<InterCodeLink[^>]*>([^<]*)<\/InterCodeLink>/gi, '$1')
    .replace(/<AnnotationDrawer[^>]*\/?>/gi, '')
    .replace(/<AnnotationDrawer[^>]*>[\s\S]*?<\/AnnotationDrawer>/gi, '')
    // Remove data attributes
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, '')
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n');
}

/** Extract Redux state from AMLegal SPA HTML */
function extractReduxState(html: string): any {
  const reduxMatch = html.match(/window\._redux_state\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (reduxMatch) {
    try { return JSON.parse(reduxMatch[1]); } catch { /* ignore */ }
  }
  const preloadMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (preloadMatch) {
    try { return JSON.parse(preloadMatch[1]); } catch { /* ignore */ }
  }
  return null;
}

function guessLevel(section: AmlegalSection): string {
  if (section.level) return section.level;
  if (section.type) return section.type;
  const title = (section.title || '').toLowerCase();
  return guessLevelFromTitle(title);
}

function guessLevelFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('chapter ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('section ') || t.startsWith('sec.') || t.startsWith('§') || /^\d/.test(t)) return 'section';
  return 'section';
}
