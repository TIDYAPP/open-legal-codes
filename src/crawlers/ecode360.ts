import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://ecode360.com';
const LIBRARY_BASE = 'https://www.generalcode.com';

/**
 * eCode360 / General Code Crawler Adapter
 *
 * eCode360 hosts ~4,400+ municipal and county codes across 25+ states.
 *
 * Key discovery: eCode360 embeds structured JSON data in HTML attributes:
 *   - `data-toc-nodes` on <section id="code-toc-widget"> — complete TOC tree
 *   - `data-customer` on <body> — jurisdiction metadata (name, state, county, pop)
 *   - `window.SERVER_DATA` in <script> — config and version info
 *
 * URL patterns:
 *   TOC:      https://ecode360.com/{custId}         (e.g., /HO0741)
 *   Section:  https://ecode360.com/{numericGuid}     (e.g., /15244465)
 *   Search:   https://ecode360.com/{custId}/search?query={term}
 *   Library:  https://www.generalcode.com/source-library/?state={ST}
 *
 * IMPORTANT: eCode360 blocks requests without browser-like headers.
 * The HttpClient must send Accept and Accept-Language headers.
 * The /print/ endpoint is blocked even with browser headers — use regular pages.
 *
 * Customer IDs follow the pattern: 2 uppercase letters + 4 digits (e.g., HO0741).
 * Section GUIDs are numeric strings of 7-8 digits (e.g., 15244465).
 *
 * The sourceId for this adapter is the customer ID (e.g., "HO0741").
 */
export class Ecode360Crawler implements CrawlerAdapter {
  readonly publisherName = 'ecode360' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({
      minDelayMs: 500,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  }

  async dispose(): Promise<void> {
    if (typeof (this.http as any).dispose === 'function') {
      await (this.http as any).dispose();
    }
  }

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const states = state ? [state.toUpperCase()] : [];

    if (states.length === 0) {
      console.warn('[ecode360] listJurisdictions requires a --state filter. Visit generalcode.com/source-library/ to browse.');
      return;
    }

    for (const abbr of states) {
      console.log(`[ecode360] Fetching jurisdictions for ${abbr}`);
      let html: string;
      try {
        html = await this.http.getHtml(`${LIBRARY_BASE}/source-library/`, { state: abbr });
      } catch (err) {
        console.warn(`[ecode360] Failed to fetch library for ${abbr}: ${err}`);
        continue;
      }

      const $ = cheerio.load(html);

      // Library page lists jurisdictions as links to ecode360.com/{custId}
      $('a[href*="ecode360.com/"]').each((_i, el) => {
        // This is inside the async generator, so we collect and yield below
      });

      // Collect all jurisdiction links
      const links: Array<{ custId: string; name: string }> = [];
      $('a[href*="ecode360.com/"]').each((_i, el) => {
        const href = $(el).attr('href') || '';
        const custIdMatch = href.match(/ecode360\.com\/([A-Z]{2}\d{4})/);
        if (!custIdMatch) return;

        const name = $(el).text().trim();
        if (!name) return;

        links.push({ custId: custIdMatch[1], name });
      });

      for (const { custId, name } of links) {
        const slug = custId.toLowerCase();
        yield {
          id: `${abbr.toLowerCase()}-ecode360-${slug}`,
          name: `${name}`,
          type: inferEcode360Type(name),
          state: abbr,
          parentId: abbr.toLowerCase(),
          fips: null,
          publisher: {
            name: 'ecode360' as const,
            sourceId: custId,
            url: `${SITE_BASE}/${custId}`,
          },
          lastCrawled: '',
          lastUpdated: '',
        };
      }
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    // Try the JSON TOC API endpoint first (works with Browserbase)
    const tocApiUrl = `${SITE_BASE}/toc/${sourceId}`;
    console.log(`[ecode360] Fetching TOC from ${tocApiUrl}`);

    try {
      const tocHtml = await this.http.getHtml(tocApiUrl);
      // Extract JSON: strip HTML tags if the browser wrapped it in <html><body><pre>...
      const $ = cheerio.load(tocHtml);
      const jsonText = $('pre').first().text() || $('body').text() || tocHtml;
      const tocRoot: Ecode360TocNode = JSON.parse(jsonText.trim());
      // Root node is the code itself; children are the top-level parts
      const children = tocRoot.children || [];
      console.log(`[ecode360] Got ${children.length} top-level TOC nodes from API`);
      return children.map(node => this.transformTocNode(node));
    } catch (err) {
      console.warn(`[ecode360] TOC API failed, falling back to HTML: ${err}`);
    }

    // Fallback: fetch the main page and extract TOC
    const url = `${SITE_BASE}/${sourceId}`;
    console.log(`[ecode360] Fetching TOC from ${url} (HTML fallback)`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    // Extract structured TOC from data-toc-nodes attribute
    const tocWidget = $('section#code-toc-widget, [data-toc-nodes]').first();
    const tocJson = tocWidget.attr('data-toc-nodes');

    if (tocJson) {
      try {
        const tocNodes: Ecode360TocNode[] = JSON.parse(tocJson);
        return tocNodes.map(node => this.transformTocNode(node));
      } catch (err) {
        console.warn(`[ecode360] Failed to parse data-toc-nodes JSON: ${err}`);
      }
    }

    // Last resort: parse TOC from HTML links
    console.warn('[ecode360] No data-toc-nodes found, falling back to link parsing');
    return this.parseTocFromLinks($);
  }

  private transformTocNode(node: Ecode360TocNode): RawTocNode {
    const title = node.indexNum && node.tocName
      ? `${node.indexNum} - ${node.tocName}`
      : node.tocName || node.title || node.prefix || '';

    return {
      id: node.guid,
      title,
      level: mapEcode360Level(node.type || node.label || ''),
      hasContent: node.type === 'section' || (!node.children?.length && node.type !== 'code'),
      children: (node.children || []).map(c => this.transformTocNode(c)),
    };
  }

  private parseTocFromLinks($: cheerio.CheerioAPI): RawTocNode[] {
    const result: RawTocNode[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/^\/(\d{5,})$/);
      if (!match) return;

      const id = match[1];
      if (seen.has(id)) return;
      seen.add(id);

      const title = $(el).text().trim();
      if (!title || title.length < 3) return;

      result.push({
        id,
        title,
        level: guessLevel(title),
        hasContent: true,
        children: [],
      });
    });

    return result;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const url = `${SITE_BASE}/${sectionId}`;
    console.log(`[ecode360] Fetching section ${sectionId}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    // Try to extract section content by GUID
    const sectionContent = $(`#${sectionId}_content`).first();
    if (sectionContent.length) {
      const sectionTitle = $(`.contentTitle[data-guid="${sectionId}"], #${sectionId}_title`).first();
      const titleHtml = sectionTitle.length ? sectionTitle.toString() : '';
      return {
        html: titleHtml + sectionContent.html(),
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
      };
    }

    // For chapter/article pages rendered by Browserbase, extract all section contents
    const allSections = $('[id$="_content"]');
    if (allSections.length > 1) {
      let combinedHtml = '';
      allSections.each((_i, el) => {
        const id = $(el).attr('id')?.replace('_content', '') || '';
        const title = $(`#${id}_title`).first();
        combinedHtml += (title.length ? title.toString() : '') + $.html(el);
      });
      return {
        html: combinedHtml,
        fetchedAt: new Date().toISOString(),
        sourceUrl: url,
      };
    }

    // Fall back to extracting all content from the page
    const content = $('#codebody, .codebody, #codeText, .content-area').first();
    const cleanHtml = content.length ? content.html() || html : html;

    return {
      html: cleanHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

// --- eCode360 embedded data types ---

interface Ecode360TocNode {
  prefix?: string;
  tocName?: string;
  guid: string;
  parent?: string;
  href?: string;
  title?: string;
  number?: string;
  indexNum?: string;
  type?: string;       // "code", "division", "chapter", "article", "section"
  label?: string;      // "Chapter", "Article", "Section"
  hideNumber?: boolean;
  children?: Ecode360TocNode[];
}

// --- Helpers ---

function inferEcode360Type(name: string): 'city' | 'county' {
  const lower = name.toLowerCase();
  if (lower.includes('city and county') || lower.includes('city & county')) return 'city';
  if (lower.includes('county')) return 'county';
  return 'city';
}

function mapEcode360Level(type: string): string {
  const t = type.toLowerCase();
  const map: Record<string, string> = {
    'code': 'title',
    'division': 'division',
    'chapter': 'chapter',
    'article': 'article',
    'section': 'section',
    'part': 'part',
    'subpart': 'subpart',
    'appendix': 'part',
  };
  return map[t] || guessLevel(type);
}

function guessLevel(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('chapter ') || t.startsWith('ch ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('section ') || t.startsWith('§') || /^\d+[\.\-]/.test(t)) return 'section';
  return 'section';
}
