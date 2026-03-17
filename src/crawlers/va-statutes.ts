import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://law.lis.virginia.gov';

/**
 * Code of Virginia
 *
 * Scrapes law.lis.virginia.gov which has clean server-rendered HTML.
 *
 * URL patterns:
 *   TOC:     /vacode/                          — title index (66 titles)
 *   Title:   /vacode/title{N}/                 — chapter listing
 *   Section: /vacode/title{N}/chapter{M}/section{N}-{S}/
 *
 * sectionId format: URL path after /vacode/ e.g. "title1/" or "title2.2/"
 *
 * Note: VA title numbers include decimals (title2.2, title8.01) and letter
 * suffixes (title8.1A) — the regex must match alphanumeric+dot patterns.
 */
export class VaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'va-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'va-statutes',
      name: 'Code of Virginia',
      type: 'state',
      state: 'VA',
      parentId: 'va',
      fips: '51',
      publisher: {
        name: 'va-statutes',
        sourceId: 'va-statutes',
        url: `${SITE_BASE}/vacode/`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/vacode/`;
    console.log(`[va-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseTitles($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId is the URL path after /vacode/ e.g. "title1/" or "title2.2/"
    const url = `${SITE_BASE}/vacode/${sectionId}`;
    console.log(`[va-statutes] Fetching ${sectionId} from ${url}`);

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

function parseTitles($: cheerio.CheerioAPI): RawTocNode[] {
  const nodes: RawTocNode[] = [];
  const seen = new Set<string>();

  // Title links like /vacode/title1/ or /vacode/title2.2/ or /vacode/title8.1A/
  // Must match alphanumeric+dot title numbers (e.g., title2.2, title8.01, title8.1A)
  $('a[href*="/vacode/title"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // Match /vacode/title<alphanum+dot> at end of URL (no sub-path after title)
    const match = href.match(/\/vacode\/(title[\w.]+)\/?$/i);
    if (!match) return;

    const path = match[1] + '/';
    if (seen.has(path)) return;
    seen.add(path);

    nodes.push({
      id: path,
      title,
      level: 'title',
      hasContent: true,
      children: [],
    });
  });

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  const selectors = [
    '#codified-law-container',
    '#law-body',
    '.law-body',
    '.statute-body',
    '#main-content',
    'div.container main',
    'main',
    '#content',
    'div.col-md-9',
    'div.col-sm-9',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer, .breadcrumb, .btn, .alert').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer, .navbar, .breadcrumb').remove();
  return $('body').html() || '';
}
