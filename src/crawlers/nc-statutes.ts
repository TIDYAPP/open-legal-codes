import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://www.ncleg.gov';

/**
 * North Carolina General Statutes
 *
 * Scrapes static HTML files from ncleg.gov.
 *
 * URL patterns:
 *   TOC:     /Laws/GeneralStatutesTOC  — chapter index
 *   Chapter: /EnactedLegislation/Statutes/HTML/ByChapter/Chapter_{N}.html
 *
 * sectionId format: "Chapter_{N}" (e.g., "Chapter_1", "Chapter_160D")
 */
export class NcStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'nc-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'nc-statutes',
      name: 'North Carolina General Statutes',
      type: 'state',
      state: 'NC',
      parentId: 'nc',
      fips: '37',
      publisher: {
        name: 'nc-statutes',
        sourceId: 'nc-statutes',
        url: `${SITE_BASE}/Laws/GeneralStatutesTOC`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/Laws/GeneralStatutesTOC`;
    console.log(`[nc-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: "Chapter_{N}" e.g. "Chapter_1", "Chapter_160D"
    const chapterName = sectionId.startsWith('Chapter_') ? sectionId : `Chapter_${sectionId}`;
    const url = `${SITE_BASE}/EnactedLegislation/Statutes/HTML/ByChapter/${chapterName}.html`;
    console.log(`[nc-statutes] Fetching chapter ${sectionId} from ${url}`);

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
  // The TOC page has pairs of divs for each chapter:
  //   <div><a href="/Laws/GeneralStatuteSections/Chapter1">Chapter 1</a></div>
  //   <div><a href="/Laws/GeneralStatuteSections/Chapter1">Civil Procedure</a></div>
  //
  // Group all links by href, then for each chapter use:
  //   - The "Chapter N" text as the chapter number
  //   - The other text(s) as the title

  const byHref = new Map<string, string[]>(); // href -> list of link texts

  $('a[href*="GeneralStatuteSections/Chapter"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text) return;

    const match = href.match(/GeneralStatuteSections\/Chapter(\w+)$/i);
    if (!match) return;

    const existing = byHref.get(href) || [];
    existing.push(text);
    byHref.set(href, existing);
  });

  const nodes: RawTocNode[] = [];
  const order: string[] = [];

  // Preserve order by iterating links in document order
  $('a[href*="GeneralStatuteSections/Chapter"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    if (!byHref.has(href) || order.includes(href)) return;
    order.push(href);
  });

  for (const href of order) {
    const texts = byHref.get(href) || [];
    const match = href.match(/GeneralStatuteSections\/Chapter(\w+)$/i);
    if (!match) continue;

    const chapterNum = match[1];
    const nodeId = `Chapter_${chapterNum}`;

    // First text is typically "Chapter N", second is the chapter name
    const chapterLabel = texts.find(t => t.match(/^Chapter\s+\w+$/i)) || `Chapter ${chapterNum}`;
    const titleText = texts.find(t => !t.match(/^Chapter\s+\w+$/i)) || '';
    const fullTitle = titleText ? `${chapterLabel} - ${titleText}` : chapterLabel;

    nodes.push({
      id: nodeId,
      title: fullTitle,
      level: 'chapter',
      hasContent: true,
      children: [],
    });
  }

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  const selectors = [
    '#content',
    '.statute-body',
    '.chapter-body',
    'div.container',
    'div#main',
    'div.main-content',
    'body > div > div',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer, .breadcrumb, .navigation').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer, .navbar, .breadcrumb').remove();
  return $('body').html() || '';
}
