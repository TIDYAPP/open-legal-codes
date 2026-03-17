import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://www.ilga.gov';

/**
 * Illinois Compiled Statutes (ILCS)
 *
 * Scrapes ilga.gov/Legislation/ILCS/ — a stable HTML site.
 *
 * URL patterns:
 *   TOC:   /Legislation/ILCS/Chapters
 *     Lists all chapters (5, 10, 15, ...) as links to Acts pages
 *   Acts:  /Legislation/ILCS/Acts?ChapterID={id}&ChapterNumber={n}&...
 *     Lists all Acts within a chapter
 *
 * sectionId format: "ChapterID={id}" e.g. "ChapterID=2"
 */
export class IlStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'il-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    yield {
      id: 'il-statutes',
      name: 'Illinois Compiled Statutes',
      type: 'state',
      state: 'IL',
      parentId: 'il',
      fips: '17',
      publisher: {
        name: 'il-statutes',
        sourceId: 'il-statutes',
        url: `${SITE_BASE}/Legislation/ILCS/Chapters`,
      },
      lastCrawled: '',
      lastUpdated: '',
    };
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/Legislation/ILCS/Chapters`;
    console.log(`[il-statutes] Fetching TOC from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId: "ChapterID={id}" → loads the Acts page for that chapter
    let url: string;
    if (sectionId.startsWith('http')) {
      url = sectionId;
    } else if (sectionId.startsWith('ChapterID=')) {
      url = `${SITE_BASE}/Legislation/ILCS/Acts?${sectionId}`;
    } else {
      url = `${SITE_BASE}/Legislation/ILCS/Acts?ChapterID=${sectionId}`;
    }

    console.log(`[il-statutes] Fetching ${sectionId} from ${url}`);

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

  // Chapter links like /Legislation/ILCS/Acts?ChapterID=2&ChapterNumber=5&...
  $('a[href*="ChapterID="]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // Only capture Acts-level chapter links (not individual Act or section links)
    if (!href.includes('/Acts?') && !href.includes('/Acts%3F')) return;

    const match = href.match(/ChapterID=(\d+)/i);
    if (!match) return;

    const chapterId = match[1];
    const nodeId = `ChapterID=${chapterId}`;
    if (seen.has(nodeId)) return;
    seen.add(nodeId);

    nodes.push({
      id: nodeId,
      title: title.replace(/\s+/g, ' ').trim(),
      level: 'chapter',
      hasContent: true,
      children: [],
    });
  });

  return nodes;
}

function extractContent($: cheerio.CheerioAPI): string {
  const selectors = [
    'div.ilcs',
    '#content',
    'div.mainbody',
    'td.mainbody',
    'div#mainbody',
    'table.text',
    'body > table',
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
