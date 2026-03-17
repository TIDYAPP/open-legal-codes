import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://codes.ohio.gov';

/**
 * Ohio Revised Code
 *
 * Scrapes codes.ohio.gov which organizes the ORC by title.
 *
 * URL patterns:
 *   TOC:    /ohio-revised-code                      — title index
 *   Title:  /ohio-revised-code/title-{N}            — title with chapters (e.g., title-1)
 *   Chapter:/ohio-revised-code/chapter-{N}          — chapter with sections
 *   Section:/ohio-revised-code/section-{N}.{S}      — individual section
 *
 * The main TOC lists title-N and general-provisions links.
 * sectionId format: "title-{N}" e.g. "title-1"
 */
export class OhStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'oh-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'oh-statutes',
      name: 'Ohio Revised Code',
      type: 'state',
      state: 'OH',
      parentId: 'oh',
      fips: '39',
      publisher: {
        name: 'oh-statutes',
        sourceId: 'oh-statutes',
        url: `${SITE_BASE}/ohio-revised-code`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/ohio-revised-code`;
    console.log(`[oh-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: "title-{N}" e.g. "title-1"
    const url = `${SITE_BASE}/ohio-revised-code/${sectionId}`;
    console.log(`[oh-statutes] Fetching ${sectionId} from ${url}`);

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

  // Title and general-provisions links from the main page
  // Relative URLs like "ohio-revised-code/title-1" or "ohio-revised-code/general-provisions"
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    const match = href.match(/ohio-revised-code\/(title-\d+|general-provisions)\/?$/i);
    if (!match) return;

    const pathId = match[1];
    if (seen.has(pathId)) return;
    seen.add(pathId);

    nodes.push({
      id: pathId,
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
    'article',
    'main',
    '#main-content',
    '.chapter-content',
    '.law-content',
    '#content',
    'div[role=main]',
    'div.container main',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer, .breadcrumb, aside').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer, .navbar, .breadcrumb, aside').remove();
  return $('body').html() || '';
}
