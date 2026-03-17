import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://leginfo.legislature.ca.gov';

/**
 * California Law Codes (30 codes)
 * Property-relevant codes include:
 *   CIV — Civil Code (landlord/tenant, property rights, CC&Rs)
 *   GOV — Government Code (planning, zoning, CEQA)
 *   HSC — Health and Safety Code (building codes, habitability)
 *   BPC — Business and Professions Code (contractor licensing)
 *   RTC — Revenue and Taxation Code (property tax)
 */
const CA_CODES: Array<{ code: string; name: string }> = [
  { code: 'BPC', name: 'Business and Professions Code' },
  { code: 'CIV', name: 'Civil Code' },
  { code: 'CCP', name: 'Code of Civil Procedure' },
  { code: 'COM', name: 'Commercial Code' },
  { code: 'CONS', name: 'Constitution' },
  { code: 'CORP', name: 'Corporations Code' },
  { code: 'EDC', name: 'Education Code' },
  { code: 'ELEC', name: 'Elections Code' },
  { code: 'EVID', name: 'Evidence Code' },
  { code: 'FAM', name: 'Family Code' },
  { code: 'FIN', name: 'Financial Code' },
  { code: 'FGC', name: 'Fish and Game Code' },
  { code: 'FAC', name: 'Food and Agricultural Code' },
  { code: 'GOV', name: 'Government Code' },
  { code: 'HNC', name: 'Harbors and Navigation Code' },
  { code: 'HSC', name: 'Health and Safety Code' },
  { code: 'INS', name: 'Insurance Code' },
  { code: 'LAB', name: 'Labor Code' },
  { code: 'MVC', name: 'Military and Veterans Code' },
  { code: 'PEN', name: 'Penal Code' },
  { code: 'PROB', name: 'Probate Code' },
  { code: 'PCC', name: 'Public Contract Code' },
  { code: 'PRC', name: 'Public Resources Code' },
  { code: 'PUC', name: 'Public Utilities Code' },
  { code: 'RTC', name: 'Revenue and Taxation Code' },
  { code: 'SHC', name: 'Streets and Highways Code' },
  { code: 'UIC', name: 'Unemployment Insurance Code' },
  { code: 'VEH', name: 'Vehicle Code' },
  { code: 'WAT', name: 'Water Code' },
  { code: 'WIC', name: 'Welfare and Institutions Code' },
];

/**
 * California Legislature Crawler Adapter
 *
 * Scrapes California statutes from leginfo.legislature.ca.gov.
 * California provides structured HTML with clear URL patterns:
 *
 *   TOC:     /faces/codesTOCSelected.xhtml?tocCode={CODE}
 *   Expand:  /faces/codes_displayexpandedbranch.xhtml?tocCode={CODE}&title={T}&...
 *   Text:    /faces/codes_displayText.xhtml?lawCode={CODE}&division=D&title=T&part=P&chapter=C&article=A
 *   Section: /faces/codes_displaySection.xhtml?lawCode={CODE}&sectionNum={NUM}
 *
 * The displayText endpoint returns ALL sections in a chapter/article at once,
 * making it the most efficient endpoint for bulk crawling.
 *
 * The sourceId is the code abbreviation (e.g., "GOV", "CIV", "HSC").
 *
 * California data is public domain per Government Code Section 10248.5.
 * Bulk downloads also available at downloads.leginfo.legislature.ca.gov
 * (tab-delimited .dat files with XML content in LOB files).
 */
export class CaliforniaLeginfoCrawler implements CrawlerAdapter {
  readonly publisherName = 'ca-leginfo' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    for (const code of CA_CODES) {
      yield {
        id: `ca-${code.code.toLowerCase()}`,
        name: `California ${code.name}`,
        type: 'state',
        state: 'CA',
        parentId: 'ca',
        fips: '06',
        publisher: {
          name: 'ca-leginfo',
          sourceId: code.code,
          url: `${SITE_BASE}/faces/codesTOCSelected.xhtml?tocCode=${code.code}`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/faces/codesTOCSelected.xhtml?tocCode=${sourceId}&tocTitle=+${sourceId}`;
    console.log(`[ca-leginfo] Fetching TOC for ${sourceId}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);

    const result: RawTocNode[] = [];

    // The TOC page lists top-level divisions/titles with expand links
    // and displayText links for leaf chapters
    $('a[href*="codes_displayexpandedbranch"], a[href*="codes_displayText"]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const title = link.text().trim();
      if (!title || title.length < 3) return;

      // Store the full query string as the node ID so we can reconstruct the URL directly.
      // This avoids fragile positional mapping of colon-separated params.
      const queryString = href.split('?')[1] || '';
      const id = `${sourceId}|${queryString}`;
      const level = guessLevelFromTitle(title);
      const isExpand = href.includes('codes_displayexpandedbranch');

      result.push({
        id,
        title,
        level,
        hasContent: !isExpand,
        children: [],
      });
    });

    // Fetch children for expandable nodes
    const expandResults: RawTocNode[] = [];
    for (const node of result) {
      if (!node.hasContent) {
        const children = await this.fetchExpandedBranch(sourceId, node);
        if (children.length > 0) {
          node.children = children;
        } else {
          node.hasContent = true;
        }
      }
      expandResults.push(node);
    }

    return expandResults.length > 0 ? expandResults : result;
  }

  private async fetchExpandedBranch(sourceId: string, parentNode: RawTocNode): Promise<RawTocNode[]> {
    // The node ID stores the full query string from the original href.
    // Use it directly to build the expand URL.
    const queryString = parentNode.id.split('|')[1] || '';
    const expandUrl = `${SITE_BASE}/faces/codes_displayexpandedbranch.xhtml?${queryString}`;

    try {
      const html = await this.http.getHtml(expandUrl);
      const $ = cheerio.load(html);

      const children: RawTocNode[] = [];

      $('a[href*="codes_displayText"], a[href*="codes_displayexpandedbranch"]').each((_i, el) => {
        const link = $(el);
        const href = link.attr('href') || '';
        const title = link.text().trim();
        if (!title || title.length < 3) return;

        const childQueryString = href.split('?')[1] || '';
        const id = `${sourceId}|${childQueryString}`;
        const isExpand = href.includes('codes_displayexpandedbranch');

        children.push({
          id,
          title,
          level: guessLevelFromTitle(title),
          hasContent: !isExpand,
          children: [],
        });
      });

      return children;
    } catch {
      return [];
    }
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "CODE|queryString" where queryString is the full URL params
    // from the original codes_displayText href.
    const queryString = sectionId.split('|')[1] || sectionId;

    // The stored query string uses tocCode= (from TOC links) but codes_displayText
    // uses lawCode=. Normalize the param name.
    const normalizedQuery = queryString.replace(/\btocCode=/, 'lawCode=');
    const url = `${SITE_BASE}/faces/codes_displayText.xhtml?${normalizedQuery}`;

    console.log(`[ca-leginfo] Fetching section ${sectionId}`);
    const html = await this.http.getHtml(url);

    // Extract the code content from the page
    const $ = cheerio.load(html);
    const cleanHtml = extractCodeContent($);

    // Use the same URL as the permalink
    const sectionUrl = `${SITE_BASE}/faces/codes_displayText.xhtml?${normalizedQuery}`;

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: sectionUrl,
    };
  }
}

// --- Helpers ---

/**
 * Extract the code content from a CA leginfo page.
 * The site uses JSF with specific content containers:
 * - Section numbers in <h6> tags
 * - Section text in <p> tags
 * - Headers in <h4>/<h5> tags
 */
function extractCodeContent($: cheerio.CheerioAPI): string {
  // Try known content containers in order of specificity
  const selectors = [
    '#manylawsections',
    '#codedisplay',
    '.law-section-body',
    '#codebody',
    '[id*="codetext"]',
    '#content_main',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 50) return html;
  }

  // Fall back: gather all <h6> (section nums) and following content
  const sections: string[] = [];
  $('h6').each((_i, el) => {
    const heading = $(el).toString();
    const content: string[] = [heading];
    $(el).nextUntil('h6').each((_j, sibling) => {
      content.push($(sibling).toString());
    });
    sections.push(content.join('\n'));
  });

  return sections.join('\n\n');
}

function guessLevelFromTitle(title: string): string {
  const t = title.toLowerCase().trim();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('chapter ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('section ') || t.startsWith('§') || /^\d/.test(t)) return 'section';
  return 'title';
}
