import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';

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

    // Extract TOC from the Redux state
    const version = state?.codes?.selectedVersion;
    if (!version?.toc) {
      throw new Error(`No TOC found in Redux state for ${sourceId}`);
    }

    const result: RawTocNode[] = [];
    for (const code of version.toc) {
      const codeNode: RawTocNode = {
        id: code.slug || code.uuid || String(code.id),
        title: code.title,
        level: 'title',
        hasContent: false,
        children: [],
      };

      // Each code has a sections array representing its top-level structure
      if (code.sections && Array.isArray(code.sections)) {
        for (const section of code.sections) {
          codeNode.children.push(this.transformSection(section, code.slug));
        }
      }

      result.push(codeNode);
    }

    return result;
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

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId format: "{code_slug}/{doc_id}"
    const [codeSlug, docId] = sectionId.split('/', 2);
    if (!codeSlug || !docId) {
      throw new Error(`Invalid sectionId format: "${sectionId}". Expected "code_slug/doc_id"`);
    }

    const url = `${SITE_BASE}/codes/${sourceId}/latest/${codeSlug}/${docId}`;
    console.log(`[amlegal] Fetching section ${sectionId}`);

    const html = await this.http.getHtml(url);
    const state = extractReduxState(html);

    if (!state) {
      throw new Error(`Could not extract Redux state from ${url}`);
    }

    // Extract section content from Redux state
    const sections = state?.sections;
    let contentHtml = '';

    if (sections?.items && Array.isArray(sections.items)) {
      // Find the matching section or use all items
      const matching = sections.items.find(
        (item: any) => item.doc_id === docId || String(item.id) === docId
      );
      contentHtml = matching?.html || sections.items.map((item: any) => item.html || '').join('\n');
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
  // Match: window._redux_state = JSON.parse("...");
  // or: window._redux_state = {...};
  const jsonParseMatch = html.match(/window\._redux_state\s*=\s*JSON\.parse\("(.+?)"\);/s);
  if (jsonParseMatch) {
    try {
      // The string is double-escaped JSON
      const unescaped = jsonParseMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      return JSON.parse(unescaped);
    } catch {
      // Try without unescaping
      try {
        return JSON.parse(jsonParseMatch[1]);
      } catch {
        return null;
      }
    }
  }

  // Alternative: window._redux_state = {...}
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
  if (title.startsWith('title ')) return 'title';
  if (title.startsWith('chapter ')) return 'chapter';
  if (title.startsWith('article ')) return 'article';
  if (title.startsWith('division ')) return 'division';
  if (title.startsWith('part ')) return 'part';
  if (title.startsWith('section ') || title.startsWith('sec.') || /^\d/.test(title)) return 'section';
  if (section.has_children || section.has_section_children) return 'chapter';
  return 'section';
}
