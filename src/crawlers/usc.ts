import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://uscode.house.gov';

/**
 * All 54 USC titles. Title 53 is reserved.
 *
 * Property/STR-relevant titles:
 *   Title 15 — Commerce and Trade (FCRA §1681+, VGBA Pool Safety §8001+)
 *   Title 42 — The Public Health and Welfare (Fair Housing Act §3601+, ADA §12101+)
 */
const USC_TITLES: Array<{ number: number; name: string }> = [
  { number: 1, name: 'General Provisions' },
  { number: 2, name: 'The Congress' },
  { number: 3, name: 'The President' },
  { number: 4, name: 'Flag and Seal, Seat of Government, and the States' },
  { number: 5, name: 'Government Organization and Employees' },
  { number: 6, name: 'Homeland Security' },
  { number: 7, name: 'Agriculture' },
  { number: 8, name: 'Aliens and Nationality' },
  { number: 9, name: 'Arbitration' },
  { number: 10, name: 'Armed Forces' },
  { number: 11, name: 'Bankruptcy' },
  { number: 12, name: 'Banks and Banking' },
  { number: 13, name: 'Census' },
  { number: 14, name: 'Coast Guard' },
  { number: 15, name: 'Commerce and Trade' },
  { number: 16, name: 'Conservation' },
  { number: 17, name: 'Copyrights' },
  { number: 18, name: 'Crimes and Criminal Procedure' },
  { number: 19, name: 'Customs Duties' },
  { number: 20, name: 'Education' },
  { number: 21, name: 'Food and Drugs' },
  { number: 22, name: 'Foreign Relations and Intercourse' },
  { number: 23, name: 'Highways' },
  { number: 24, name: 'Hospitals and Asylums' },
  { number: 25, name: 'Indians' },
  { number: 26, name: 'Internal Revenue Code' },
  { number: 27, name: 'Intoxicating Liquors' },
  { number: 28, name: 'Judiciary and Judicial Procedure' },
  { number: 29, name: 'Labor' },
  { number: 30, name: 'Mineral Lands and Mining' },
  { number: 31, name: 'Money and Finance' },
  { number: 32, name: 'National Guard' },
  { number: 33, name: 'Navigation and Navigable Waters' },
  { number: 34, name: 'Crime Control and Law Enforcement' },
  { number: 35, name: 'Patents' },
  { number: 36, name: 'Patriotic and National Observances, Ceremonies, and Organizations' },
  { number: 37, name: 'Pay and Allowances of the Uniformed Services' },
  { number: 38, name: "Veterans' Benefits" },
  { number: 39, name: 'Postal Service' },
  { number: 40, name: 'Public Buildings, Property, and Works' },
  { number: 41, name: 'Public Contracts' },
  { number: 42, name: 'The Public Health and Welfare' },
  { number: 43, name: 'Public Lands' },
  { number: 44, name: 'Public Printing and Documents' },
  { number: 45, name: 'Railroads' },
  { number: 46, name: 'Shipping' },
  { number: 47, name: 'Telecommunications' },
  { number: 48, name: 'Territories and Insular Possessions' },
  { number: 49, name: 'Transportation' },
  { number: 50, name: 'War and National Defense' },
  { number: 51, name: 'National and Commercial Space Programs' },
  { number: 52, name: 'Voting and Elections' },
  { number: 53, name: '[Reserved]' },
  { number: 54, name: 'National Park Service and Related Programs' },
];

/**
 * United States Code (USC) Crawler Adapter
 *
 * Scrapes the US Code from uscode.house.gov, published by the
 * Office of the Law Revision Counsel of the US House of Representatives.
 *
 * URL patterns:
 *   TOC browse:  /browse/prelim@title{N}&edition=prelim
 *   Section:     /view.xhtml?req=granuleid:USC-prelim-title{N}-section{S}&num=0&edition=prelim
 *
 * The sourceId for this adapter is the title number (e.g., "42").
 *
 * Permalinks: https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{N}-section{S}&num=0&edition=prelim
 */
export class UscCrawler implements CrawlerAdapter {
  readonly publisherName = 'usc' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    for (const title of USC_TITLES) {
      // Skip reserved title
      if (title.name === '[Reserved]') continue;

      yield {
        id: `us-usc-title-${title.number}`,
        name: `USC Title ${title.number} — ${title.name}`,
        type: 'federal',
        state: null,
        parentId: 'us',
        fips: null,
        publisher: {
          name: 'usc',
          sourceId: String(title.number),
          url: `${SITE_BASE}/browse/prelim@title${title.number}&edition=prelim`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const titleNum = sourceId;
    const url = `${SITE_BASE}/browse/prelim@title${titleNum}&edition=prelim`;

    console.log(`[usc] Fetching TOC for USC Title ${titleNum}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    const result: RawTocNode[] = [];

    // The browse page lists chapters/subtitles/parts as expandable tree items.
    // Links to sections follow the pattern: /view.xhtml?req=granuleid:USC-prelim-title{N}-section{S}
    // Links to structural nodes (chapters, subtitles) follow: /browse/prelim@title{N}/...

    // First, try to find structured TOC items from the browse tree
    // The site uses a tree with nested <ul> / <li> elements and links
    $('a[href]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const text = link.text().trim();
      if (!text || text.length < 2) return;

      // Match section links: /view.xhtml?req=granuleid:USC-prelim-title{N}-section{S}
      const sectionMatch = href.match(
        /view\.xhtml\?req=granuleid:USC-prelim-title(\d+)-section(\d+\w*)/,
      );
      if (sectionMatch) {
        const sectionNum = sectionMatch[2];
        result.push({
          id: sectionNum,
          title: text.replace(/\s+/g, ' ').trim(),
          level: 'section',
          hasContent: true,
          children: [],
        });
        return;
      }

      // Match structural browse links: /browse/prelim@title{N}/chapter{C}
      const browseMatch = href.match(
        /browse\/prelim@title\d+\/(.*?)(?:&|$)/,
      );
      if (browseMatch) {
        const nodeId = browseMatch[1];
        const level = guessLevelFromId(nodeId);
        result.push({
          id: nodeId,
          title: text.replace(/\s+/g, ' ').trim(),
          level,
          hasContent: false,
          children: [],
        });
      }
    });

    // If we found browse nodes but no sections, expand the top-level nodes
    if (result.length > 0 && result.every(n => !n.hasContent)) {
      for (const node of result) {
        try {
          const children = await this.fetchBrowseChildren(titleNum, node.id);
          if (children.length > 0) {
            node.children = children;
          }
        } catch {
          // Skip nodes that fail to expand
        }
      }
    }

    return result;
  }

  /**
   * Expand a browse node to fetch its children (chapters, sections, etc.)
   */
  private async fetchBrowseChildren(
    titleNum: string,
    nodeId: string,
  ): Promise<RawTocNode[]> {
    const url = `${SITE_BASE}/browse/prelim@title${titleNum}/${nodeId}&edition=prelim`;

    console.log(`[usc] Expanding browse node: title ${titleNum} / ${nodeId}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    const children: RawTocNode[] = [];

    $('a[href]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const text = link.text().trim();
      if (!text || text.length < 2) return;

      // Match section links
      const sectionMatch = href.match(
        /view\.xhtml\?req=granuleid:USC-prelim-title(\d+)-section(\d+\w*)/,
      );
      if (sectionMatch) {
        const sectionNum = sectionMatch[2];
        children.push({
          id: sectionNum,
          title: text.replace(/\s+/g, ' ').trim(),
          level: 'section',
          hasContent: true,
          children: [],
        });
        return;
      }

      // Match deeper browse links
      const browseMatch = href.match(
        /browse\/prelim@title\d+\/(.*?)(?:&|$)/,
      );
      if (browseMatch) {
        const childId = browseMatch[1];
        // Avoid self-references
        if (childId !== nodeId) {
          const level = guessLevelFromId(childId);
          children.push({
            id: childId,
            title: text.replace(/\s+/g, ' ').trim(),
            level,
            hasContent: false,
            children: [],
          });
        }
      }
    });

    return children;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const titleNum = sourceId;

    // Build the granule ID URL for the section
    const url = `${SITE_BASE}/view.xhtml`;
    const params: Record<string, string> = {
      req: `granuleid:USC-prelim-title${titleNum}-section${sectionId}`,
      num: '0',
      edition: 'prelim',
    };

    console.log(`[usc] Fetching section ${sectionId} of USC Title ${titleNum}`);

    const html = await this.http.getHtml(url, params);
    const $ = cheerio.load(html);

    // Extract the statute content from the page
    const cleanHtml = extractUscContent($);

    const sourceUrl =
      `${SITE_BASE}/view.xhtml?req=granuleid:USC-prelim-title${titleNum}-section${sectionId}&num=0&edition=prelim`;

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
  }
}

// --- Helpers ---

/**
 * Extract the statute content from a uscode.house.gov view page.
 * The site renders section text inside specific content containers.
 */
function extractUscContent($: cheerio.CheerioAPI): string {
  // Try known content containers in order of specificity
  const selectors = [
    '#content-container',
    '#content',
    '.usctextcontainer',
    '.usctext',
    '#main-content',
    '.section-content',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 50) return html;
  }

  // Fallback: get the body content minus navigation/header/footer
  $('nav, header, footer, script, style, #sidebar, .navigation').remove();
  const bodyHtml = $('body').html() || '';
  if (bodyHtml.length > 100) return bodyHtml;

  return '';
}

/**
 * Guess the structural level from a browse node ID.
 * Examples: "chapter1", "subtitle-A", "part-I"
 */
function guessLevelFromId(nodeId: string): string {
  const id = nodeId.toLowerCase();
  if (id.startsWith('subtitle')) return 'subtitle';
  if (id.startsWith('chapter')) return 'chapter';
  if (id.startsWith('subchapter')) return 'subchapter';
  if (id.startsWith('part')) return 'part';
  if (id.startsWith('subpart')) return 'subpart';
  if (id.startsWith('division')) return 'division';
  if (id.startsWith('article')) return 'article';
  return 'chapter';
}
