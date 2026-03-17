import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://apps.leg.wa.gov';

/**
 * Revised Code of Washington (RCW)
 *
 * Scrapes apps.leg.wa.gov/rcw/default.aspx which has server-rendered HTML
 * with all RCW titles listed on the main page.
 *
 * URL patterns:
 *   TOC:    /rcw/default.aspx                         — title index
 *   Title:  /rcw/default.aspx?Cite={N}               — chapter listing (e.g., Cite=9A)
 *   Chapter:/rcw/default.aspx?Cite={N}.{M}           — section listing
 *   Section:/rcw/default.aspx?Cite={N}.{M}.{S}       — section text
 *
 * sectionId format: Cite value e.g. "1" (title) or "9A.08" (chapter)
 * Note: query param is "Cite" (capital C) not "cite"
 */
export class WaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'wa-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'wa-statutes',
      name: 'Revised Code of Washington',
      type: 'state',
      state: 'WA',
      parentId: 'wa',
      fips: '53',
      publisher: {
        name: 'wa-statutes',
        sourceId: 'wa-statutes',
        url: `${SITE_BASE}/rcw/default.aspx`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/rcw/default.aspx`;
    console.log(`[wa-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseTitles($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId is the Cite value e.g. "1" or "9A.08" or "9A.08.010"
    const url = `${SITE_BASE}/rcw/default.aspx?Cite=${encodeURIComponent(sectionId)}`;
    console.log(`[wa-statutes] Fetching Cite=${sectionId} from ${url}`);

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

  // Title links like default.aspx?Cite=1 or default.aspx?Cite=9A
  // Note: param is "Cite" (capital C); text is "Title 1", "Title 2", etc.
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // Match only Cite= links
    const match = href.match(/[?&]Cite=([^&.]+)$/i);
    if (!match) return;

    // Only top-level titles — Cite value with no dots
    const cite = decodeURIComponent(match[1]);
    if (cite.includes('.')) return;

    if (seen.has(cite)) return;
    seen.add(cite);

    nodes.push({
      id: cite,
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
    '#ContentPlaceHolder1_rcwContent',
    '#rcwContent',
    '.rcw-content',
    '#ContentPlaceHolder1_UpdatePanel1',
    '#main-content',
    '#content',
    'div.container',
    'form#form1',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer, input[type=submit]').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer, .navbar').remove();
  return $('body').html() || '';
}
