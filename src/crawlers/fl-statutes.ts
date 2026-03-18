import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';

const SITE_BASE = 'http://www.leg.state.fl.us/statutes';

/**
 * Florida Statutes Crawler Adapter
 *
 * Scrapes Florida statutes from leg.state.fl.us/statutes/.
 *
 * Florida statutes are organized as a single body:
 *   Title (48 titles) → Chapter (~1000 chapters) → Section
 *
 * URL patterns:
 *   Title index:  /index.cfm?App_mode=Display_Index&Title_Request=I  (Roman numeral)
 *   Chapter:      /index.cfm?App_mode=Display_Statute&URL=0000-0099/0001/0001.html
 *   Section:      /index.cfm?App_mode=Display_Statute&Search_String=&URL=0000-0099/0083/Sections/0083.49.html
 *
 * The main TOC is at /index.cfm?App_mode=Display_TOC which lists all titles and chapters.
 *
 * The sourceId is always "fl-statutes" (single jurisdiction).
 */
export class FloridaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'fl-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'fl-statutes',
      name: 'Florida Statutes',
      type: 'state',
      state: 'FL',
      parentId: 'fl',
      fips: '12',
      publisher: {
        name: 'fl-statutes',
        sourceId: 'fl-statutes',
        url: `${SITE_BASE}/index.cfm?App_mode=Display_TOC`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    // Step 1: Fetch the main TOC page to discover title links.
    // The TOC page lists titles with Display_Index links but does NOT have
    // chapter-level Display_Statute links — those are on each title's index page.
    const tocUrl = `${SITE_BASE}/index.cfm?App_mode=Display_TOC`;
    console.log(`[fl-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);

    // Collect title links (e.g., "TITLE I" → Display_Index&Title_Request=I)
    const titleLinks: Array<{ text: string; titleParam: string }> = [];
    $('a[href*="Display_Index"]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const text = link.text().trim();
      if (!text || text.length < 2) return;
      const paramMatch = href.match(/Title_Request=([^&#]+)/);
      if (paramMatch) {
        // Grab the sibling text node that has the title description
        const parent = link.parent();
        const fullText = parent.text().trim() || text;
        titleLinks.push({ text: fullText.length > text.length ? fullText : text, titleParam: paramMatch[1] });
      }
    });

    if (titleLinks.length === 0) {
      console.log(`[fl-statutes] No title links found on TOC page, trying fallback`);
      return this.fetchTocFallback($);
    }

    console.log(`[fl-statutes] Found ${titleLinks.length} titles, fetching chapter lists in parallel...`);

    // Step 2: Fetch each title's index page to get chapter links.
    // Use parallel fetches (concurrency=4) to avoid the ~72s sequential delay
    // that would occur with 48 titles × 1500ms delay.
    const limit = pLimit(4);

    const titles = await Promise.all(
      titleLinks.map(tl => limit(async () => {
        const titleNode: RawTocNode = {
          id: buildNodeId('title', tl.text),
          title: tl.text,
          level: 'title',
          hasContent: false,
          children: [],
        };

        try {
          const indexUrl = `${SITE_BASE}/index.cfm?App_mode=Display_Index&Title_Request=${encodeURIComponent(tl.titleParam)}`;
          const indexHtml = await this.http.getHtml(indexUrl);
          const $idx = cheerio.load(indexHtml);

          $idx('a[href*="Display_Statute"]').each((_i, el) => {
            const link = $idx(el);
            const href = link.attr('href') || '';
            const text = link.text().trim();
            if (!text || text.length < 2) return;

            const chapterNode: RawTocNode = {
              id: buildChapterIdFromUrl(href) || buildNodeId('chapter', text),
              title: text,
              level: 'chapter',
              hasContent: true,
              children: [],
            };
            titleNode.children!.push(chapterNode);
          });
        } catch (err) {
          console.error(`[fl-statutes] Failed to fetch title index for ${tl.titleParam}:`, err);
        }

        return titleNode;
      }))
    );

    const totalChapters = titles.reduce((sum, t) => sum + (t.children?.length || 0), 0);
    console.log(`[fl-statutes] Found ${titles.length} titles with ${totalChapters} chapters`);
    return titles;
  }

  /**
   * Fallback TOC parsing: scan all links on the page for chapter/section patterns.
   */
  private fetchTocFallback($: cheerio.CheerioAPI): RawTocNode[] {
    const nodes: RawTocNode[] = [];

    $('a').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const text = link.text().trim();
      if (!text || text.length < 3) return;

      // Look for URLs containing chapter number patterns like /0083/ or chapter references
      const chapterMatch = href.match(/URL=(\d{4}-\d{4}\/\d{4}\/\d{4}\.html)/);
      if (chapterMatch) {
        nodes.push({
          id: `chapter|${chapterMatch[1]}`,
          title: text,
          level: 'chapter',
          hasContent: true,
          children: [],
        });
      }
    });

    return nodes;
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId can be:
    //   "chapter|URL_PATH" — a chapter URL path
    //   "section|URL_PATH" — a specific section URL path
    //   or a raw URL path
    const parts = sectionId.split('|');
    const urlPath = parts.length > 1 ? parts[parts.length - 1] : sectionId;

    // Build the full URL
    let url: string;
    if (urlPath.startsWith('http')) {
      url = urlPath;
    } else if (urlPath.includes('App_mode')) {
      url = `${SITE_BASE}/${urlPath}`;
    } else {
      url = `${SITE_BASE}/index.cfm?App_mode=Display_Statute&Search_String=&URL=${urlPath}`;
    }

    console.log(`[fl-statutes] Fetching section: ${url}`);
    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    const cleanHtml = extractStatuteContent($);

    // Build permalink URL — use flsenate.gov for a cleaner permalink
    const permalink = buildPermalink(sectionId);

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: permalink || url,
    };
  }
}

// --- Helpers ---

/**
 * Build a node ID from a title or chapter description.
 */
function buildNodeId(level: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${level}|${slug}`;
}

/**
 * Extract a chapter ID from a Display_Statute URL.
 * e.g., "...&URL=0000-0099/0083/0083.html" → "chapter|0000-0099/0083/0083.html"
 */
function buildChapterIdFromUrl(href: string): string | null {
  const urlMatch = href.match(/URL=([^&\s]+)/);
  if (urlMatch) {
    return `chapter|${urlMatch[1]}`;
  }
  return null;
}

/**
 * Build a permalink for a Florida statute section.
 * Uses the flsenate.gov URL format when possible.
 */
function buildPermalink(sectionId: string): string | null {
  // Try to extract a section number like "83.49" from the sectionId
  const sectionMatch = sectionId.match(/(\d+\.\d+)/);
  if (sectionMatch) {
    return `http://www.flsenate.gov/Laws/Statutes/${sectionMatch[1]}`;
  }

  // For chapter-level content, extract chapter number
  const chapterMatch = sectionId.match(/\/(\d{4})\/\d{4}\.html/);
  if (chapterMatch) {
    const chapterNum = parseInt(chapterMatch[1], 10);
    return `http://www.flsenate.gov/Laws/Statutes/${chapterNum}`;
  }

  return null;
}

/**
 * Extract the statute content from a Florida Legislature page.
 * The leg.state.fl.us pages embed statute text in various containers.
 */
function extractStatuteContent($: cheerio.CheerioAPI): string {
  // Try known content containers in order of specificity
  const selectors = [
    // The statute display area
    '#statutes',
    '.Statute',
    '.statuteText',
    '#ContentPlaceHolder1_StatuteContent',
    // Generic content areas
    '.Content',
    '#Content',
    'td.Statute',
    // Broadest fallback
    '#maincontent',
    'body table table',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 100) {
      return cleanStatuteHtml($, el);
    }
  }

  // Fallback: look for section headings (e.g., "83.49 Deposit money or advance rent;")
  // Florida sections often appear as bold text followed by content
  const sections: string[] = [];
  $('b, strong').each((_i, el) => {
    const text = $(el).text().trim();
    // Check if it looks like a section number (e.g., "83.49")
    if (/^\d+\.\d+/.test(text)) {
      const heading = $(el).toString();
      const content: string[] = [heading];
      $(el).parent().nextUntil('p:has(b), p:has(strong)').each((_j, sibling) => {
        content.push($(sibling).toString());
      });
      sections.push(content.join('\n'));
    }
  });

  if (sections.length > 0) {
    return sections.join('\n\n');
  }

  return '';
}

/**
 * Clean extracted HTML: remove navigation, scripts, styles, and ads.
 */
function cleanStatuteHtml($: cheerio.CheerioAPI, container: cheerio.Cheerio<any>): string {
  // Clone to avoid mutating the original
  const clone = container.clone();

  // Remove unwanted elements
  clone.find('script, style, nav, .navbar, .footer, .breadcrumb, .navigation, iframe, .ad').remove();

  return clone.html() || '';
}
