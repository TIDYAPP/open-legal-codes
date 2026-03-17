import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import * as cheerio from 'cheerio';

/**
 * Tennessee Code (via LexisNexis)
 *
 * The official Tennessee Code is hosted by LexisNexis at:
 *   https://www.lexisnexis.com/hottopics/tncode/
 * which redirects to advance.lexis.com.
 *
 * This adapter requires a browser (Browserbase) to render the JavaScript-heavy
 * LexisNexis pages. Pass a FallbackHttpClient via the constructor.
 *
 * sectionId format: "title-{n}" e.g. "title-1"
 */

const BASE_URL = 'https://www.lexisnexis.com/hottopics/tncode/';

export class TnStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'tn-statutes' as const;
  private http: { getHtml(url: string, params?: Record<string, string>): Promise<string>; dispose?(): Promise<void> };

  constructor(http?: any) {
    if (!http) {
      throw new Error('[tn-statutes] TnStatutesCrawler requires an HTTP client (FallbackHttpClient) for JavaScript rendering');
    }
    this.http = http;
  }

  async dispose(): Promise<void> {
    if (typeof this.http.dispose === 'function') {
      await this.http.dispose();
    }
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'tn-statutes',
      name: 'Tennessee Code',
      type: 'state',
      state: 'TN',
      parentId: 'tn',
      fips: '47',
      publisher: {
        name: 'tn-statutes',
        sourceId: 'tn-statutes',
        url: BASE_URL,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    console.log(`[tn-statutes] Fetching TOC from ${BASE_URL}`);
    const html = await this.http.getHtml(BASE_URL);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId is a full URL or a relative path from the TOC
    let url: string;
    if (sectionId.startsWith('http')) {
      url = sectionId;
    } else {
      url = sectionId;
    }

    console.log(`[tn-statutes] Fetching section ${sectionId}`);
    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);
    const cleanHtml = extractContent($);

    if (!cleanHtml.trim()) {
      throw new Error(`[tn-statutes] Empty content for ${sectionId}`);
    }

    return {
      html: cleanHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

/**
 * Parse TOC from the rendered LexisNexis page.
 *
 * LexisNexis "Hot Topics" pages render a hierarchical tree of links.
 * We look for links to titles (e.g., "Title 1 - General Provisions").
 */
function parseToc($: cheerio.CheerioAPI): RawTocNode[] {
  const nodes: RawTocNode[] = [];
  const seen = new Set<string>();

  // LexisNexis pages use various link patterns for title navigation.
  // Look for links containing "title" or numbered entries in the TOC tree.
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text || text.length < 3) return;

    // Match links that reference Tennessee Code titles
    const titleMatch = text.match(/^Title\s+(\d+)/i);
    if (!titleMatch) return;

    const titleNum = titleMatch[1];
    const nodeId = `title-${titleNum}`;
    if (seen.has(nodeId)) return;
    seen.add(nodeId);

    // Resolve the URL for this title
    let titleUrl = href;
    if (!titleUrl.startsWith('http')) {
      // Relative URL — resolve against the base
      try {
        titleUrl = new URL(href, BASE_URL).toString();
      } catch {
        titleUrl = href;
      }
    }

    nodes.push({
      id: titleUrl, // Use the full URL as the ID so fetchSection can navigate to it
      title: text.replace(/\s+/g, ' ').trim(),
      level: 'title',
      hasContent: true,
      children: [],
    });
  });

  // Sort by title number
  nodes.sort((a, b) => {
    const numA = parseInt(a.title.match(/Title\s+(\d+)/i)?.[1] || '0');
    const numB = parseInt(b.title.match(/Title\s+(\d+)/i)?.[1] || '0');
    return numA - numB;
  });

  console.log(`[tn-statutes] Found ${nodes.length} titles in TOC`);

  if (nodes.length === 0) {
    // Dump some page info for debugging
    const pageTitle = $('title').text();
    const bodyLen = $('body').text().length;
    const linkCount = $('a[href]').length;
    console.warn(`[tn-statutes] No titles found. Page title: "${pageTitle}", body length: ${bodyLen}, links: ${linkCount}`);
    throw new Error(`[tn-statutes] Could not parse TOC — no title links found. Page may require additional JavaScript rendering or authentication.`);
  }

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  // Remove navigation, scripts, ads
  $('script, style, nav, header, footer, .navbar, aside, .ad, #header, #footer, #nav').remove();

  // Try common LexisNexis content selectors
  const selectors = [
    '#mainContentComponent',
    '.document-content',
    '.content-body',
    '#document',
    'article',
    'main',
    '#content',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 200) {
      return html;
    }
  }

  // Fallback to body
  return $('body').html() || '';
}
