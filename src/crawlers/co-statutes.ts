import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

// Official CRS is hosted by LexisNexis (requires auth).
// colorado.public.law provides clean, publicly accessible HTML of the CRS.
const SITE_BASE = 'https://colorado.public.law';

/**
 * Colorado Revised Statutes (CRS)
 *
 * Note: Official CRS is hosted by LexisNexis via leg.colorado.gov and is not
 * freely scrapable. This adapter uses colorado.public.law which provides
 * full CRS text in clean HTML. Permalinks point to colorado.public.law.
 *
 * URL patterns:
 *   TOC:    /statutes                          — title index
 *   Title:  /statutes/crs_title_{N}            — article/section listing
 *   Section:/statutes/crs_title_{N},...        — individual section
 *
 * sectionId format: path segment after /statutes/ e.g. "crs_title_1"
 */
export class CoStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'co-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({
      minDelayMs: 2000,
      userAgent: 'Mozilla/5.0 (compatible; OpenLegalCodes/0.1)',
    });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'co-statutes',
      name: 'Colorado Revised Statutes',
      type: 'state',
      state: 'CO',
      parentId: 'co',
      fips: '08',
      publisher: {
        name: 'co-statutes',
        sourceId: 'co-statutes',
        url: `${SITE_BASE}/statutes`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/statutes`;
    console.log(`[co-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: path after /statutes/ e.g. "crs_title_1"
    const url = sectionId.startsWith('http')
      ? sectionId
      : `${SITE_BASE}/statutes/${sectionId}`;

    console.log(`[co-statutes] Fetching ${sectionId} from ${url}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);
    const cleanHtml = extractContent($);

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

function parseToc($: cheerio.CheerioAPI): RawTocNode[] {
  const nodes: RawTocNode[] = [];
  const seen = new Set<string>();

  // Title links like /statutes/crs_title_1
  $('a[href*="/statutes/crs_title_"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const el$ = $(el);

    // Only top-level title links (no commas = not a section URL)
    const match = href.match(/\/statutes\/(crs_title_\d+)$/i);
    if (!match) return;

    const titleId = match[1];
    if (seen.has(titleId)) return;
    seen.add(titleId);

    // Text is split between .number and .name divs inside the anchor
    const number = el$.find('.number').text().trim();
    const name = el$.find('.name').text().trim();
    const title = number && name
      ? `Title ${number} - ${name}`
      : el$.text().replace(/\s+/g, ' ').trim();

    if (!title || title.length < 2) return;

    nodes.push({
      id: titleId,
      title,
      level: 'title',
      hasContent: true,
      children: [],
    });
  });

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  // colorado.public.law-specific selectors in priority order
  const selectors = [
    '#leaf-statute-body',   // Section pages: statute text
    'article',              // Section pages: full article (title + body)
    '#mid-level-node',      // Title/article pages: division/section listings
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (!el.length) continue;
    el.find('script, style, nav, .breadcrumb, .adsbygoogle, ins.adsbygoogle, .d-print-none.mt-5').remove();
    const html = el.html() || '';
    if (html.length > 50) return html;
  }

  // Fallback: main content column (excludes ad sidebar)
  const contentCol = $('div.col-sm-10.col-print-12').first();
  if (contentCol.length) {
    contentCol.find('script, style, nav, .breadcrumb, .adsbygoogle, ins.adsbygoogle').remove();
    const html = contentCol.html() || '';
    if (html.length > 50) return html;
  }

  // Last resort
  $('script, style, nav#top-navbar, header, footer, .adsbygoogle, .breadcrumb, #sibling-nav').remove();
  return $('body').html() || '';
}
