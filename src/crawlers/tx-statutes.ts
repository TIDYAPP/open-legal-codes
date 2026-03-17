import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';
import { parsePdf, type PdfSection } from '../converter/pdf-to-html.js';

const SITE_BASE = 'https://statutes.capitol.texas.gov';
const API_BASE = 'https://tcss.legis.texas.gov/api';

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

interface TexasCodeCatalogResponse {
  StatuteCode: Array<{
    codeID: string;
    code: string;
    CodeName: string;
  }>;
}

interface TexasHeadingNode {
  name: string;
  children: TexasHeadingNode[] | null;
  value: string;
  valuePath: string;
  expandable: boolean;
  pdfLink: string | null;
  docLink: string | null;
  htmLink: string | null;
}

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
  private codeIdByCodePromise: Promise<Map<string, string>> | null = null;
  private pdfCache = new Map<string, PdfSection[]>();

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
    try {
      const codeId = await this.resolveCodeId(sourceId);
      const tocUrl = `${API_BASE}/StatuteCode/GetTopLevelHeadings/${encodeURIComponent(`S/${codeId}`)}/${sourceId}/1/true/false`;
      console.log(`[tx-statutes] Fetching TOC for ${sourceId} from ${tocUrl}`);

      const headings = await this.http.getJson<TexasHeadingNode[]>(tocUrl);
      return headings.map((node) => this.headingToRawNode(sourceId, node));
    } catch (err) {
      console.error(`[tx-statutes] Failed to fetch TOC for ${sourceId}:`, err);
      return [];
    }
  }

  private async resolveCodeId(sourceId: string): Promise<string> {
    if (!this.codeIdByCodePromise) {
      this.codeIdByCodePromise = this.http
        .getJson<TexasCodeCatalogResponse>(`${SITE_BASE}/assets/StatuteCodeTree.json`)
        .then((catalog) => {
          const mapping = new Map<string, string>();
          for (const item of catalog.StatuteCode) {
            mapping.set(item.code, item.codeID);
          }
          return mapping;
        });
    }

    const mapping = await this.codeIdByCodePromise;
    const codeId = mapping.get(sourceId);
    if (!codeId) {
      throw new Error(`Texas code ID not found for ${sourceId}`);
    }
    return codeId;
  }

  private headingToRawNode(sourceId: string, node: TexasHeadingNode): RawTocNode {
    const children = (node.children ?? []).map((child) => this.headingToRawNode(sourceId, child));
    const sourcePath = node.pdfLink || node.htmLink || node.valuePath;

    return {
      id: `${sourceId}|${sourcePath}`,
      title: node.name.trim(),
      level: guessLevelFromTitle(node.name),
      hasContent: Boolean(node.pdfLink || node.htmLink),
      children,
    };
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "{CODE}|{path}" e.g. "LG|/LG/pdf/LG.53.pdf"
    const parts = sectionId.split('|');
    const resourcePath = parts[1] || sectionId;

    const url = resourcePath.startsWith('http')
      ? resourcePath
      : `${SITE_BASE}${resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`}`;
    console.log(`[tx-statutes] Fetching section ${sectionId} from ${url}`);

    try {
      if (resourcePath.toLowerCase().endsWith('.pdf')) {
        let sections = this.pdfCache.get(url);
        if (!sections) {
          const buffer = await this.http.getBuffer(url);
          const parsed = await parsePdf(buffer);
          sections = parsed.sections;
          this.pdfCache.set(url, sections);
        }

        const html = sections
          .map((section) => `<h2>${escapeHtml(section.title)}</h2>\n${section.html}`)
          .join('\n');

        return {
          html,
          fetchedAt: new Date().toISOString(),
          sourceUrl: url,
        };
      }

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
