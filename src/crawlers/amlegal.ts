import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://codelibrary.amlegal.com';

/**
 * American Legal Publishing Crawler Adapter
 *
 * AMLegal's site is a React SPA, but all structured data is embedded
 * in the initial HTML as a Redux state blob via window._redux_state.
 * This means we can extract TOC and content with plain HTTP — no Playwright.
 *
 * URL patterns:
 *   Overview/TOC: /codes/{client_slug}/latest/overview
 *   Section:      /codes/{client_slug}/latest/{code_slug}/{doc_id}
 *
 * The sourceId for this adapter is the client_slug (e.g., "san_francisco").
 */
export class AmlegalCrawler implements CrawlerAdapter {
  readonly publisherName = 'amlegal' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1000 });
  }

  async dispose(): Promise<void> {
    if (typeof (this.http as any).dispose === 'function') {
      await (this.http as any).dispose();
    }
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    // AMLegal doesn't have a state-based listing API.
    // The overview page lists jurisdictions but requires scraping the main library page.
    // For now, jurisdictions must be added manually to jurisdictions.json.
    console.warn('[amlegal] listJurisdictions requires manual entry. Visit codelibrary.amlegal.com to find slugs.');
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const url = `${SITE_BASE}/codes/${sourceId}/latest/overview`;
    console.log(`[amlegal] Fetching TOC from ${url}`);

    const html = await this.http.getHtml(url);
    const state = extractReduxState(html);
    if (!state) {
      throw new Error(`Could not extract Redux state from ${url}`);
    }

    // Try Redux state first (works with plain HTTP when not blocked)
    if (state) {
      const version = state?.codes?.selectedVersion;
      if (version?.toc) {
        const result: RawTocNode[] = [];
        for (const code of version.toc) {
          const codeNode: RawTocNode = {
            id: code.slug || code.uuid || String(code.id),
            title: code.title,
            level: 'title',
            hasContent: false,
            children: [],
          };
          if (code.sections && Array.isArray(code.sections)) {
            for (const section of code.sections) {
              codeNode.children.push(this.transformSection(section, code.slug));
            }
          }
          result.push(codeNode);
        }
        return result;
      }
    }

    // Fallback: parse TOC from rendered HTML links (works with Browserbase)
    console.log('[amlegal] Redux state empty, parsing TOC from rendered HTML');
    return this.parseTocFromHtml(html, sourceId);
  }

  private transformSection(section: AmlegalSection, codeSlug: string): RawTocNode {
    const docId = section.doc_id || String(section.id);
    return {
      id: `${codeSlug}/${docId}`,
      title: section.title || `Section ${docId}`,
      level: guessLevel(section),
      hasContent: !section.has_children && !section.has_section_children,
      children: [], // Children are fetched lazily during crawl
    };
  }

  private parseTocFromHtml(html: string, sourceId: string): RawTocNode[] {
    const $ = cheerio.load(html);
    const result: RawTocNode[] = [];
    const codeGroups = new Map<string, RawTocNode>();

    // AMLegal links follow pattern: /codes/{sourceId}/latest/{codeSlug}/{docId}
    const linkPattern = new RegExp(`/codes/${sourceId}/latest/([^/]+)/([^/"]+)`);

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(linkPattern);
      if (!match) return;

      const [, codeSlug, docId] = match;
      const title = $(el).text().trim();
      if (!title || title.length < 2) return;

      // Group by code slug
      if (!codeGroups.has(codeSlug)) {
        codeGroups.set(codeSlug, {
          id: codeSlug,
          title: codeSlug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          level: 'title',
          hasContent: false,
          children: [],
        });
      }

      const sectionNode: RawTocNode = {
        id: `${codeSlug}/${docId}`,
        title,
        level: guessLevelFromTitle(title),
        hasContent: true,
        children: [],
      };

      codeGroups.get(codeSlug)!.children.push(sectionNode);
    });

    for (const node of codeGroups.values()) {
      result.push(node);
    }
    console.log(`[amlegal] Parsed ${result.length} codes with ${result.reduce((n, c) => n + c.children.length, 0)} sections from HTML`);
    return result;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "{code_slug}/{doc_id}"
    const [codeSlug, docId] = sectionId.split('/', 2);
    if (!codeSlug || !docId) {
      throw new Error(`Invalid sectionId format: "${sectionId}". Expected "code_slug/doc_id"`);
    }

    const url = `${SITE_BASE}/codes/${sourceId}/latest/${codeSlug}/${docId}`;
    console.log(`[amlegal] Fetching section ${sectionId}`);

    const html = await this.http.getHtml(url);
    let contentHtml = '';

    // Try Redux state first
    const state = extractReduxState(html);
    if (state) {
      const sections = state?.sections;
      if (sections?.items && Array.isArray(sections.items)) {
        const matching = sections.items.find(
          (item: any) => item.doc_id === docId || String(item.id) === docId
        );
        contentHtml = matching?.html || sections.items.map((item: any) => item.html || '').join('\n');
      }
    }

    // Fallback: extract from rendered HTML (Browserbase)
    if (!contentHtml) {
      const $ = cheerio.load(html);
      // AMLegal renders content in .akn-act or main content area
      const rendered = $('.akn-act, .codes-content, .code-content, main .content, [class*="section-content"]').first();
      if (rendered.length) {
        contentHtml = rendered.html() || '';
      }
    }

    if (!contentHtml) {
      // Fall back to extracting from the page HTML directly
      contentHtml = extractContentFromHtml(html);
    }

    // Strip React components that won't render as HTML
    contentHtml = cleanAmlegalHtml(contentHtml);

    return {
      html: contentHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

// --- Internal types ---

interface AmlegalSection {
  id: number;
  doc_id: string;
  title: string;
  type?: string;
  has_children?: boolean;
  has_section_children?: boolean;
}

// --- Helpers ---

/**
 * Extract the Redux state blob from AMLegal's HTML.
 * The state is embedded as: window._redux_state = JSON.parse("...");
 */
function extractReduxState(html: string): any | null {
  // Find the JSON.parse("...") call containing the Redux state.
  // Can't use a simple regex because the content has escaped quotes (\").
  // Instead, find the opening and closing positions manually.
  const marker = 'window._redux_state';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const parseStart = html.indexOf('JSON.parse("', markerIdx);
  if (parseStart !== -1) {
    const jsonStart = parseStart + 'JSON.parse("'.length;
    // Find the closing: unescaped " followed by , or )
    // Walk through the string, skipping escaped quotes
    let i = jsonStart;
    while (i < html.length) {
      if (html[i] === '\\') {
        i += 2; // Skip escaped character
        continue;
      }
      if (html[i] === '"') {
        // Found unescaped quote — this is the end of the JSON string
        break;
      }
      i++;
    }

    if (i < html.length) {
      const raw = html.substring(jsonStart, i);
      try {
        const unescaped = raw
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return JSON.parse(unescaped);
      } catch {
        try { return JSON.parse(raw); } catch { /* fall through */ }
      }
    }
  }

  // Pattern 2: window._redux_state = {...}
  const directMatch = html.match(/window\._redux_state\s*=\s*(\{.+?\});/s);
  if (directMatch) {
    try {
      return JSON.parse(directMatch[1]);
    } catch {
      return null;
    }
  }

  return null;
}

/** Extract content from HTML when Redux state parsing fails */
function extractContentFromHtml(html: string): string {
  // Look for common AMLegal content containers
  const contentMatch = html.match(/<div[^>]*class="[^"]*(?:codes-content|code-content|akn-act)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (contentMatch) return contentMatch[1];

  // Fall back to body content
  const bodyMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (bodyMatch) return bodyMatch[1];

  return '';
}

/** Strip React components and clean up AMLegal HTML */
function cleanAmlegalHtml(html: string): string {
  return html
    // Remove React components
    .replace(/<InterCodeLink[^>]*>([^<]*)<\/InterCodeLink>/gi, '$1')
    .replace(/<AnnotationDrawer[^>]*\/?>/gi, '')
    .replace(/<AnnotationDrawer[^>]*>[\s\S]*?<\/AnnotationDrawer>/gi, '')
    // Remove data attributes
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, '')
    // Clean up whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n');
}

function guessLevel(section: AmlegalSection): string {
  const title = (section.title || '').toLowerCase();
  return guessLevelFromTitle(title) ||
    (section.has_children || section.has_section_children ? 'chapter' : 'section');
}

function guessLevelFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('chapter ') || t.startsWith('ch. ')) return 'chapter';
  if (t.startsWith('article ') || t.startsWith('art. ')) return 'article';
  if (t.startsWith('division ') || t.startsWith('div. ')) return 'division';
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('section ') || t.startsWith('sec.') || t.startsWith('§') || /^\d/.test(t)) return 'section';
  return 'section';
}
