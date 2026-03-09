import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://ecode360.com';

/**
 * eCode360 / General Code Crawler Adapter
 *
 * eCode360 hosts ~4,400+ municipal and county codes across 25+ states.
 * No public API available for free — their developer API costs $595/yr per jurisdiction.
 *
 * URL patterns (numeric IDs):
 *   TOC:      https://ecode360.com/{jurisdictionId}  (e.g., /RE0793)
 *   Section:  https://ecode360.com/{sectionId}       (e.g., /6702702)
 *   Print:    https://ecode360.com/print/{sectionId}  (cleaner HTML)
 *
 * The sourceId for this adapter is the jurisdiction code (e.g., "RE0793").
 * Section IDs are numeric strings (e.g., "6702702").
 *
 * Since eCode360 blocks scraping with 403s for basic requests, we use
 * the print view endpoint which returns cleaner HTML.
 */
export class Ecode360Crawler implements CrawlerAdapter {
  readonly publisherName = 'ecode360' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({
      minDelayMs: 2000, // Be respectful with rate limiting
      userAgent: 'Mozilla/5.0 (compatible; OpenLegalCodes/0.1; +https://openlegalcodes.org)',
    });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    // eCode360 doesn't have a public listing API.
    // Jurisdictions must be added manually to jurisdictions.json.
    // Visit https://www.generalcode.com/library/ to browse available codes.
    console.warn('[ecode360] listJurisdictions requires manual entry. Visit generalcode.com/library/ to find codes.');
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const url = `${SITE_BASE}/${sourceId}`;
    console.log(`[ecode360] Fetching TOC from ${url}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    const result: RawTocNode[] = [];

    // eCode360 uses a tree structure with nested lists
    // Look for TOC links with numeric IDs
    const tocContainer = $('#genTOC, .toc, #codeTOC, [class*="toc"]').first();
    if (tocContainer.length === 0) {
      // Fall back to parsing all links that look like section IDs
      return this.parseTocFromLinks($);
    }

    // Parse hierarchical TOC from nested lists
    const topItems = tocContainer.children('ul, ol').first().children('li');
    topItems.each((_i, el) => {
      const node = this.parseTocNode($, $(el), 0);
      if (node) result.push(node);
    });

    return result;
  }

  private parseTocNode($: cheerio.CheerioAPI, li: cheerio.Cheerio<any>, depth: number): RawTocNode | null {
    const link = li.children('a').first();
    if (!link.length) return null;

    const href = link.attr('href') || '';
    const idMatch = href.match(/\/(\d+)/);
    const id = idMatch ? idMatch[1] : href;
    const title = link.text().trim();

    if (!title) return null;

    const children: RawTocNode[] = [];
    const childList = li.children('ul, ol').first();
    if (childList.length) {
      childList.children('li').each((_i, el) => {
        const child = this.parseTocNode($, $(el), depth + 1);
        if (child) children.push(child);
      });
    }

    return {
      id,
      title,
      level: guessLevel(title, depth),
      hasContent: children.length === 0,
      children,
    };
  }

  private parseTocFromLinks($: cheerio.CheerioAPI): RawTocNode[] {
    const result: RawTocNode[] = [];
    const seen = new Set<string>();

    // Find all links that point to numeric IDs (section pages)
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/^\/(\d{5,})$/);
      if (!match) return;

      const id = match[1];
      if (seen.has(id)) return;
      seen.add(id);

      const title = $(el).text().trim();
      if (!title || title.length < 3) return;

      result.push({
        id,
        title,
        level: guessLevel(title, 0),
        hasContent: true,
        children: [],
      });
    });

    return result;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // Try the print view first — cleaner HTML without navigation chrome
    const printUrl = `${SITE_BASE}/print/${sectionId}`;
    console.log(`[ecode360] Fetching section ${sectionId}`);

    let html: string;
    try {
      html = await this.http.getHtml(printUrl);
    } catch {
      // Fall back to regular page
      const regularUrl = `${SITE_BASE}/${sectionId}`;
      html = await this.http.getHtml(regularUrl);
    }

    // Extract just the code content from the page
    const $ = cheerio.load(html);
    const content = $('#codebody, .codebody, #codeText, .codeText, [class*="code-content"]').first();
    const cleanHtml = content.length ? content.html() || html : html;

    return {
      html: cleanHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: `${SITE_BASE}/${sectionId}`,
    };
  }
}

// --- Helpers ---

function guessLevel(title: string, depth: number): string {
  const t = title.toLowerCase();
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('chapter ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('section ') || t.startsWith('§') || /^\d+[\.\-]/.test(t)) return 'section';
  if (depth <= 1) return 'part';
  if (depth === 2) return 'chapter';
  return 'section';
}
