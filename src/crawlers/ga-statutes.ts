import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

// Official OCGA is hosted by LexisNexis at advance.lexis.com (requires auth).
// The Georgia General Assembly site (legis.ga.gov) is an Angular SPA that requires
// JavaScript rendering — not scrapable with plain HTTP.
// TODO: Implement with Playwright or find an accessible static mirror.
const SITE_BASE = 'https://www.legis.ga.gov';
const OCGA_URL = `${SITE_BASE}/laws/en-US`;

/**
 * Official Code of Georgia Annotated (OCGA)
 *
 * NOTE: This adapter currently cannot crawl successfully because:
 * - Official OCGA is hosted by LexisNexis (requires auth)
 * - legis.ga.gov is an Angular SPA (requires JavaScript rendering)
 * - Third-party mirrors (Justia, FindLaw, Casetext) block server-side requests
 *
 * fetchToc() and fetchSection() will throw HTTP errors until a JS-capable
 * rendering approach is implemented (e.g., Playwright).
 *
 * URL patterns (requires JS):
 *   TOC:     https://www.legis.ga.gov/laws/en-US/display/title/1  — title listing
 *   Section: https://advance.lexis.com/...                        — via Lexis redirect
 *
 * sectionId format: Justia-style path e.g. "title-1/"
 */
export class GaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'ga-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 2000 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'ga-statutes',
      name: 'Official Code of Georgia',
      type: 'state',
      state: 'GA',
      parentId: 'ga',
      fips: '13',
      publisher: {
        name: 'ga-statutes',
        sourceId: 'ga-statutes',
        url: OCGA_URL,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    // legis.ga.gov is an Angular SPA — static HTML fetch returns only loading spinner.
    // Need Playwright/headless browser to render the statute content.
    throw new Error(
      '[ga-statutes] Georgia OCGA requires JavaScript rendering (Angular SPA). ' +
      'Plain HTTP scraping is not supported. See: ' + OCGA_URL
    );
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // Same limitation — requires JS rendering
    const url = sectionId.startsWith('http')
      ? sectionId
      : `${SITE_BASE}/laws/en-US/display/${sectionId}`;

    throw new Error(
      `[ga-statutes] Georgia OCGA requires JavaScript rendering. Cannot fetch: ${url}`
    );
  }
}

function _parseToc($: cheerio.CheerioAPI): RawTocNode[] {
  const nodes: RawTocNode[] = [];
  const seen = new Set<string>();

  $('a[href*="/display/title/"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    const match = href.match(/\/display\/title\/([\d]+)\/?$/i);
    if (!match) return;

    const titleId = `title-${match[1]}`;
    if (seen.has(titleId)) return;
    seen.add(titleId);

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
  $('script, style, nav, header, footer, .navbar, aside, .ad').remove();
  return $('body').html() || '';
}
