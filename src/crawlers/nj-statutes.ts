import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

// Official NJ Statutes are served via an NXT/Inmagic system that requires JavaScript.
// The pub.njleg.state.nj.us file server offers bulk ZIP downloads but no HTML-per-section.
// The new njleg.state.nj.us (Next.js) site does not include statute pages.
// TODO: Implement with Playwright or parse bulk text download from pub.njleg.state.nj.us.
const NXT_BASE = 'https://lis.njleg.state.nj.us';
const NXT_TOC_URL = `${NXT_BASE}/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish:10.1048/Enu`;

/**
 * New Jersey Statutes Annotated
 *
 * NOTE: This adapter currently cannot crawl successfully because:
 * - Official NJ Statutes are served by an NXT/Inmagic system that populates
 *   content via JavaScript (AJAX) — not scrapable with plain HTTP.
 * - The new njleg.state.nj.us (Next.js) site has no statute pages.
 * - Rutgers Law (njlaw.rutgers.edu) no longer hosts NJ statutes.
 * - Third-party mirrors (Justia, FindLaw) block server-side requests.
 *
 * fetchToc() and fetchSection() will throw until a JS-capable rendering
 * approach is implemented (e.g., Playwright).
 *
 * Alternative: bulk text download from pub.njleg.state.nj.us/statutes/STATUTES-TEXT.zip
 * (updated daily, plain text + RTF, but requires ZIP parsing).
 */
export class NjStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'nj-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'nj-statutes',
      name: 'New Jersey Statutes',
      type: 'state',
      state: 'NJ',
      parentId: 'nj',
      fips: '34',
      publisher: {
        name: 'nj-statutes',
        sourceId: 'nj-statutes',
        url: NXT_TOC_URL,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    // NXT system loads content via JavaScript AJAX — initial HTML is a shell.
    // The TOC container is empty until JS executes.
    throw new Error(
      '[nj-statutes] NJ Statutes NXT system requires JavaScript rendering. ' +
      'Plain HTTP scraping is not supported. See: ' + NXT_TOC_URL
    );
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // Same limitation — requires JS rendering
    throw new Error(
      `[nj-statutes] NJ Statutes NXT system requires JavaScript rendering. Cannot fetch: ${sectionId}`
    );
  }
}

function _parseToc($: cheerio.CheerioAPI): RawTocNode[] {
  const nodes: RawTocNode[] = [];
  const seen = new Set<string>();

  // Placeholder: would parse NXT TOC if JS were available
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    const match = href.match(/title[-_]?(\d+[a-z]?)/i);
    if (!match) return;

    const titleId = `title-${match[1].toLowerCase()}`;
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
  $('script, style, nav, header, footer').remove();
  return $('body').html() || '';
}
