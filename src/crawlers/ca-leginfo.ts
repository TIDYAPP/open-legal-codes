import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://leginfo.legislature.ca.gov';

/**
 * California Law Codes (28 codes)
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
  { code: 'CONS', name: 'California Constitution' },
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
 *   Text:    /faces/codes_displayText.xhtml?lawCode={CODE}&division=&title={T}&part={P}&chapter={C}&article={A}
 *   Section: /faces/codes_displaySection.xhtml?lawCode={CODE}&sectionNum={NUM}
 *
 * The sourceId is the code abbreviation (e.g., "GOV", "CIV", "HSC").
 *
 * California data is public domain per Government Code Section 10248.5.
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
    // Look for links that use codes_displayexpandedbranch or codes_displayText
    $('a[href*="codes_displayexpandedbranch"], a[href*="codes_displayText"]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const title = link.text().trim();
      if (!title || title.length < 3) return;

      // Extract URL params to build a unique ID
      const params = new URLSearchParams(href.split('?')[1] || '');
      const tocTitle = params.get('title') || '';
      const division = params.get('division') || '';
      const part = params.get('part') || '';

      const id = `${sourceId}:${division || tocTitle || part || title}`;
      const level = guessLevelFromTitle(title);

      const isExpand = href.includes('codes_displayexpandedbranch');

      result.push({
        id,
        title,
        level,
        hasContent: !isExpand, // displayText links have content, expand links are containers
        children: [],
      });
    });

    // If we got expand links, fetch their children
    const expandResults: RawTocNode[] = [];
    for (const node of result) {
      if (!node.hasContent && node.id.includes(':')) {
        const children = await this.fetchExpandedBranch(sourceId, node);
        if (children.length > 0) {
          node.children = children;
          expandResults.push(node);
        } else {
          // If no children found, mark as having content directly
          node.hasContent = true;
          expandResults.push(node);
        }
      } else {
        expandResults.push(node);
      }
    }

    return expandResults.length > 0 ? expandResults : result;
  }

  private async fetchExpandedBranch(sourceId: string, parentNode: RawTocNode): Promise<RawTocNode[]> {
    // Extract the hierarchy parts from the node ID
    const parts = parentNode.id.split(':');
    const hierarchyPart = parts[1] || '';

    // Build expand URL — try to get deeper structure
    const expandUrl = `${SITE_BASE}/faces/codes_displayexpandedbranch.xhtml?tocCode=${sourceId}&division=&title=${encodeURIComponent(hierarchyPart)}&part=&chapter=&article=`;

    try {
      const html = await this.http.getHtml(expandUrl);
      const $ = cheerio.load(html);

      const children: RawTocNode[] = [];

      $('a[href*="codes_displayText"]').each((_i, el) => {
        const link = $(el);
        const href = link.attr('href') || '';
        const title = link.text().trim();
        if (!title || title.length < 3) return;

        const params = new URLSearchParams(href.split('?')[1] || '');
        const chapter = params.get('chapter') || '';
        const article = params.get('article') || '';

        const id = `${sourceId}:${hierarchyPart}:${chapter || article || title}`;

        children.push({
          id,
          title,
          level: guessLevelFromTitle(title),
          hasContent: true, // displayText endpoints have content
          children: [],
        });
      });

      return children;
    } catch {
      return [];
    }
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "{CODE}:{title}:{chapter}" or "{CODE}:{section_num}"
    const idParts = sectionId.split(':');

    let url: string;
    if (idParts.length >= 3) {
      // Build a displayText URL for a chapter/article group
      const [, titlePart, chapterPart] = idParts;
      url = `${SITE_BASE}/faces/codes_displayText.xhtml?lawCode=${sourceId}&division=&title=${encodeURIComponent(titlePart || '')}&part=&chapter=${encodeURIComponent(chapterPart || '')}&article=`;
    } else if (idParts.length === 2) {
      // Single section by number
      url = `${SITE_BASE}/faces/codes_displaySection.xhtml?lawCode=${sourceId}&sectionNum=${encodeURIComponent(idParts[1])}`;
    } else {
      url = `${SITE_BASE}/faces/codes_displaySection.xhtml?lawCode=${sourceId}&sectionNum=${encodeURIComponent(sectionId)}`;
    }

    console.log(`[ca-leginfo] Fetching section ${sectionId}`);
    const html = await this.http.getHtml(url);

    // Extract just the code content
    const $ = cheerio.load(html);
    const content = $('#codedisplay, #codebody, [id*="codetext"], .law-section-body').first();
    const cleanHtml = content.length ? content.html() || '' : extractContentFallback($);

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

// --- Helpers ---

function extractContentFallback($: cheerio.CheerioAPI): string {
  // Look for the main content area by trying common selectors
  const selectors = [
    '#manylawsections',
    '.law-section',
    '#content_main',
    'form[id*="codes"]',
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && (el.html() || '').length > 50) {
      return el.html() || '';
    }
  }
  return '';
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
