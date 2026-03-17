import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://statutes.capitol.texas.gov';

/**
 * Texas Statutes — ~27 codes
 *
 * URL patterns:
 *   TOC:     /Docs/{CODE}/htm/toc.htm
 *   Chapter: /Docs/{CODE}/htm/{CODE}.{chapter}.htm
 *
 * The `code` field is the URL path segment used by the site.
 * The `abbrev` field is a short lowercase slug used for jurisdiction IDs.
 */
const TX_CODES: Array<{ code: string; abbrev: string; name: string }> = [
  { code: 'AG', abbrev: 'ag', name: 'Agriculture Code' },
  { code: 'AL', abbrev: 'al', name: 'Alcoholic Beverage Code' },
  { code: 'BC', abbrev: 'bc', name: 'Business & Commerce Code' },
  { code: 'BO', abbrev: 'bo', name: 'Business Organizations Code' },
  { code: 'CP', abbrev: 'cp', name: 'Civil Practice & Remedies Code' },
  { code: 'CR', abbrev: 'cr', name: 'Code of Criminal Procedure' },
  { code: 'ED', abbrev: 'ed', name: 'Education Code' },
  { code: 'EL', abbrev: 'el', name: 'Election Code' },
  { code: 'ES', abbrev: 'es', name: 'Estates Code' },
  { code: 'FA', abbrev: 'fa', name: 'Family Code' },
  { code: 'FI', abbrev: 'fi', name: 'Finance Code' },
  { code: 'GV', abbrev: 'gv', name: 'Government Code' },
  { code: 'HS', abbrev: 'hs', name: 'Health & Safety Code' },
  { code: 'HR', abbrev: 'hr', name: 'Human Resources Code' },
  { code: 'IN', abbrev: 'in', name: 'Insurance Code' },
  { code: 'LA', abbrev: 'la', name: 'Labor Code' },
  { code: 'LG', abbrev: 'lg', name: 'Local Government Code' },
  { code: 'NR', abbrev: 'nr', name: 'Natural Resources Code' },
  { code: 'OC', abbrev: 'oc', name: 'Occupations Code' },
  { code: 'PW', abbrev: 'pw', name: 'Parks & Wildlife Code' },
  { code: 'PE', abbrev: 'pe', name: 'Penal Code' },
  { code: 'PR', abbrev: 'pr', name: 'Property Code' },
  { code: 'SD', abbrev: 'sd', name: 'Special District Local Laws Code' },
  { code: 'TX', abbrev: 'tx-tax', name: 'Tax Code' },
  { code: 'TN', abbrev: 'tn', name: 'Transportation Code' },
  { code: 'UT', abbrev: 'ut', name: 'Utilities Code' },
  { code: 'WA', abbrev: 'wa', name: 'Water Code' },
];

/**
 * Texas Statutes Crawler Adapter
 *
 * Scrapes Texas statutes from statutes.capitol.texas.gov using cheerio.
 * Texas statute pages are plain HTML — no JavaScript rendering needed.
 *
 * The sourceId is the code abbreviation (e.g., "AG", "PE", "GV").
 * The sectionId is "{CODE}|{relative-path}" where relative-path is the
 * href from the TOC page (e.g., "PE|PE.1.htm").
 */
export class TexasStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'tx-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1500 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    for (const code of TX_CODES) {
      yield {
        id: `tx-${code.abbrev}`,
        name: `Texas ${code.name}`,
        type: 'state',
        state: 'TX',
        parentId: 'tx',
        fips: '48',
        publisher: {
          name: 'tx-statutes',
          sourceId: code.code,
          url: `${SITE_BASE}/Docs/${code.code}/htm/toc.htm`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/Docs/${sourceId}/htm/toc.htm`;
    console.log(`[tx-statutes] Fetching TOC for ${sourceId} from ${tocUrl}`);

    try {
      const html = await this.http.getHtml(tocUrl);
      const $ = cheerio.load(html);
      return this.parseTocPage($, sourceId);
    } catch (err) {
      console.error(`[tx-statutes] Failed to fetch TOC for ${sourceId}:`, err);
      return [];
    }
  }

  /**
   * Parse the TOC page HTML into a tree of RawTocNodes.
   *
   * Texas TOC pages typically list chapters/titles as links.
   * Links point to chapter pages like "{CODE}.{chapter}.htm".
   * We treat each link as a leaf node with content.
   */
  private parseTocPage($: cheerio.CheerioAPI, sourceId: string): RawTocNode[] {
    const result: RawTocNode[] = [];
    const seen = new Set<string>();

    // Look for links to chapter/section pages within the TOC
    // Texas TOC pages use relative links like "{CODE}.{number}.htm"
    const codePrefix = sourceId.toLowerCase();
    $('a[href]').each((_i, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const title = link.text().trim();

      if (!title || title.length < 3) return;

      // Match links that look like chapter pages: {CODE}.{something}.htm
      // Also accept relative paths within the /Docs/{CODE}/htm/ directory
      const normalizedHref = href.toLowerCase();
      if (
        !normalizedHref.endsWith('.htm') &&
        !normalizedHref.endsWith('.html')
      ) {
        return;
      }

      // Skip self-references and navigation links
      if (normalizedHref === 'toc.htm' || normalizedHref.includes('toc.htm')) {
        return;
      }

      // Extract just the filename portion for the node ID
      const filename = href.split('/').pop() || href;
      const nodeId = `${sourceId}|${filename}`;

      if (seen.has(nodeId)) return;
      seen.add(nodeId);

      const level = guessLevelFromTitle(title);

      result.push({
        id: nodeId,
        title,
        level,
        hasContent: true,
        children: [],
      });
    });

    // If we found links, try to build a hierarchy from heading structure
    // Otherwise return the flat list
    if (result.length === 0) {
      // Fallback: try to find content in list items or table cells
      $('li a[href], td a[href]').each((_i, el) => {
        const link = $(el);
        const href = link.attr('href') || '';
        const title = link.text().trim();

        if (!title || title.length < 3) return;
        if (!href.endsWith('.htm') && !href.endsWith('.html')) return;

        const filename = href.split('/').pop() || href;
        const nodeId = `${sourceId}|${filename}`;

        if (seen.has(nodeId)) return;
        seen.add(nodeId);

        result.push({
          id: nodeId,
          title,
          level: guessLevelFromTitle(title),
          hasContent: true,
          children: [],
        });
      });
    }

    return result;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "{CODE}|{filename}" e.g. "PE|PE.1.htm"
    const parts = sectionId.split('|');
    const code = parts[0] || sourceId;
    const filename = parts[1] || sectionId;

    // Build the full URL — the filename is relative to /Docs/{CODE}/htm/
    const url = `${SITE_BASE}/Docs/${code}/htm/${filename}`;
    console.log(`[tx-statutes] Fetching section ${sectionId} from ${url}`);

    try {
      const html = await this.http.getHtml(url);
      const $ = cheerio.load(html);
      const cleanHtml = extractContent($);

      return {
        html: cleanHtml || html,
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
      };
    } catch (err) {
      console.error(`[tx-statutes] Failed to fetch section ${sectionId}:`, err);
      return {
        html: `<p>Failed to fetch section: ${sectionId}</p>`,
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
      };
    }
  }
}

// --- Helpers ---

/**
 * Extract the main content from a Texas statute page.
 * Texas statute pages contain section text in the body, typically
 * with section headers and body text.
 */
function extractContent($: cheerio.CheerioAPI): string {
  // Try known content containers — Texas pages may use various structures
  const selectors = [
    '#statutes',
    '#content',
    '.statute-body',
    '.statute-content',
    'body > table',
    'body',
  ];

  for (const sel of selectors) {
    if (sel === 'body') continue; // Last resort handled below
    const el = $(sel).first();
    const html = el.html() || '';
    if (html.length > 100) return html;
  }

  // Fall back to the full body content, stripping nav/header/footer
  $('nav, header, footer, script, style, noscript').remove();
  const bodyHtml = $('body').html() || '';
  return bodyHtml;
}

function guessLevelFromTitle(title: string): string {
  const t = title.toLowerCase().trim();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('subtitle ')) return 'subtitle';
  if (t.startsWith('chapter ')) return 'chapter';
  if (t.startsWith('subchapter ')) return 'subchapter';
  if (t.startsWith('section ') || t.startsWith('sec. ') || t.startsWith('§')) return 'section';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('part ')) return 'part';
  if (/^\d/.test(t)) return 'section';
  return 'title';
}
