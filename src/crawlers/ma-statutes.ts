import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://malegislature.gov';

/**
 * Massachusetts General Laws
 *
 * Scrapes malegislature.gov which has a hierarchical URL structure.
 * The TOC page lists 5 Parts (PartI–PartV). Each Part page lists
 * Titles, each Title page lists Chapters.
 *
 * URL patterns:
 *   TOC:     /Laws/GeneralLaws                                    — Part listing
 *   Part:    /Laws/GeneralLaws/Part{I}                           — Title listing
 *   Chapter: /Laws/GeneralLaws/Part{I}/Title{I}/Chapter{N}       — section listing
 *   Section: /Laws/GeneralLaws/Part{I}/Title{I}/Chapter{N}/Section{S}
 *
 * sectionId format: URL path after /Laws/GeneralLaws/ e.g. "PartI"
 */
export class MaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'ma-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'ma-statutes',
      name: 'Massachusetts General Laws',
      type: 'state',
      state: 'MA',
      parentId: 'ma',
      fips: '25',
      publisher: {
        name: 'ma-statutes',
        sourceId: 'ma-statutes',
        url: `${SITE_BASE}/Laws/GeneralLaws`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/Laws/GeneralLaws`;
    console.log(`[ma-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: URL path after /Laws/GeneralLaws/ e.g. "PartI"
    const url = sectionId.startsWith('http')
      ? sectionId
      : `${SITE_BASE}/Laws/GeneralLaws/${sectionId}`;
    console.log(`[ma-statutes] Fetching ${sectionId} from ${url}`);

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

  // Part-only links like /Laws/GeneralLaws/PartI (not sub-paths)
  $('a[href*="/Laws/GeneralLaws/Part"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text || text.length < 2) return;

    // Match only top-level Part links (PartI, PartII, PartIII, PartIV, PartV)
    const match = href.match(/\/Laws\/GeneralLaws\/(Part[IVX]+)\/?$/i);
    if (!match) return;

    const path = match[1];
    if (seen.has(path)) return;
    seen.add(path);

    const cleanText = text.replace(/\s+/g, ' ').trim();
    nodes.push({
      id: path,
      title: cleanText,
      level: 'part',
      hasContent: true,
      children: [],
    });
  });

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  const selectors = [
    'article.general-law',
    'div.general-law',
    'div#content',
    'main',
    'div.container-fluid main',
    'div[role=main]',
    '.law-section',
    '#lawContent',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer, .breadcrumb, aside, .sidebar').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer, .navbar, .breadcrumb, aside, .sidebar').remove();
  return $('body').html() || '';
}
