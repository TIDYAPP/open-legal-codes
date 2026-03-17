import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://www.legis.state.pa.us';

/**
 * Pennsylvania Consolidated Statutes
 *
 * Scrapes legis.state.pa.us — the PA legislature's HTML site.
 *
 * URL patterns:
 *   TOC:     /cfdocs/legis/LI/Public/cons_index.cfm
 *   Section: /statutes/consolidated/view-statute?txtType=HTM&ttl={NN}
 *
 * sectionId format: "ttl={NN}" e.g. "ttl=01"
 */
export class PaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'pa-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'pa-statutes',
      name: 'Pennsylvania Consolidated Statutes',
      type: 'state',
      state: 'PA',
      parentId: 'pa',
      fips: '42',
      publisher: {
        name: 'pa-statutes',
        sourceId: 'pa-statutes',
        url: `${SITE_BASE}/cfdocs/legis/LI/Public/cons_index.cfm`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/cfdocs/legis/LI/Public/cons_index.cfm`;
    console.log(`[pa-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: "ttl={NN}" e.g. "ttl=01"
    let url: string;
    if (sectionId.startsWith('http')) {
      url = sectionId;
    } else if (sectionId.startsWith('ttl=')) {
      url = `${SITE_BASE}/statutes/consolidated/view-statute?txtType=HTM&${sectionId}`;
    } else {
      const ttl = sectionId.padStart(2, '0');
      url = `${SITE_BASE}/statutes/consolidated/view-statute?txtType=HTM&ttl=${ttl}`;
    }

    console.log(`[pa-statutes] Fetching ${sectionId} from ${url}`);

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

  // Section links: /statutes/consolidated/view-statute?txtType=HTM&ttl=NN
  $('a[href*="view-statute"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // Only HTML-format title links (not PDF or DOC)
    if (!href.includes('txtType=HTM')) return;

    const match = href.match(/[?&]ttl=(\d+)/i);
    if (!match) return;

    // Skip chapter/section sub-links
    if (href.includes('chpt=') || href.includes('sctn=')) return;
    // Skip format indicator links
    if (title.match(/^(HTML|PDF|DOC|Microsoft Word)$/i)) return;

    const ttl = match[1];
    const nodeId = `ttl=${ttl}`;
    if (seen.has(nodeId)) return;
    seen.add(nodeId);

    nodes.push({
      id: nodeId,
      title,
      level: 'title',
      hasContent: true,
      children: [],
    });
  });

  // Fallback: look for any ttl= links from old URL format
  if (nodes.length === 0) {
    $('a[href*="ttl="]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (!title || title.length < 2) return;
      if (href.includes('chpt=') || href.includes('sctn=')) return;
      if (title.match(/^(HTML|PDF|DOC)$/i)) return;

      const match = href.match(/[?&]ttl=(\d+)/i);
      if (!match) return;

      const ttl = match[1];
      const nodeId = `ttl=${ttl}`;
      if (seen.has(nodeId)) return;
      seen.add(nodeId);

      nodes.push({ id: nodeId, title, level: 'title', hasContent: true, children: [] });
    });
  }

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  const selectors = [
    '#statute',
    'div.statute',
    '#content',
    'div#content',
    '.statute-body',
    'td.LawBody',
    'div.LawBody',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      el.find('script, style, nav, .navbar, .footer').remove();
      return el.html() || '';
    }
  }

  $('script, style, nav, header, footer').remove();
  return $('body').html() || '';
}
