import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE_BASE = 'https://www.codepublishing.com';

interface KnownJurisdiction {
  name: string;
  state: string;
  slug: string;
  fips?: string;
  type?: 'city' | 'county';
}

/**
 * Code Publishing Crawler Adapter
 *
 * Code Publishing (codepublishing.com) hosts municipal codes for hundreds of
 * cities and counties. Their site uses hash-bang (#!) client-side routing with
 * Sammy.js, but the HTML content files are directly accessible at predictable
 * paths — no browser automation needed.
 *
 * URL patterns:
 *   Main page:    https://www.codepublishing.com/{STATE}/{Slug}/
 *   Title TOC:    html/{Slug}{TitleNum}/{Slug}{TitleNum}.html  (relative)
 *   Chapter:      html/{Slug}{TitleNum}/{Slug}{ChapterNum}.html (relative)
 *   Hash-bang:    /#!/{Slug}{TitleNum}/{Slug}{ChapterNum}.html
 *
 * The sourceId for this adapter is "{STATE}/{Slug}" (e.g., "CA/NewportBeach").
 * The sectionId is the relative HTML file path (e.g., "html/NewportBeach01/NewportBeach0101.html").
 */
export class CodePublishingCrawler implements CrawlerAdapter {
  readonly publisherName = 'codepublishing' as const;
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

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const dataDir = join(process.cwd(), 'data');
    const knownPath = join(dataDir, 'codepublishing-known.json');
    let known: KnownJurisdiction[];
    try {
      known = JSON.parse(readFileSync(knownPath, 'utf-8'));
    } catch {
      console.warn('[codepublishing] No codepublishing-known.json found');
      return;
    }

    if (state) {
      known = known.filter(j => j.state.toUpperCase() === state.toUpperCase());
    }

    for (const j of known) {
      const slug = toIdSlug(j.name);
      yield {
        id: `${j.state.toLowerCase()}-${slug}`,
        name: `${j.name}, ${j.state}`,
        type: j.type || inferType(j.name),
        state: j.state.toUpperCase(),
        parentId: j.state.toLowerCase(),
        fips: j.fips || null,
        publisher: {
          name: 'codepublishing' as const,
          sourceId: `${j.state}/${j.slug}`,
          url: `${SITE_BASE}/${j.state}/${j.slug}/`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const mainUrl = `${SITE_BASE}/${sourceId}/`;
    console.log(`[codepublishing] Fetching TOC from ${mainUrl}`);

    const html = await this.http.getHtml(mainUrl);
    const $ = cheerio.load(html);

    // Parse top-level TOC entries from p.tocItem elements
    const topLevel: Array<{ id: string; title: string; htmlPath: string }> = [];

    $('p.tocItem').each((_i, el) => {
      const checkbox = $(el).find('input[type="checkbox"]');
      const htmlPath = checkbox.attr('value'); // e.g., "html/NewportBeach01/NewportBeach01.html"
      const anchor = $(el).find('label.tocItemLink a');
      const title = anchor.text().trim();
      const id = anchor.attr('id') || '';

      if (!htmlPath || !title) return;

      topLevel.push({ id, title, htmlPath });
    });

    console.log(`[codepublishing] Found ${topLevel.length} top-level TOC entries`);

    // For each top-level entry, fetch the title page to get chapter links
    const result: RawTocNode[] = [];

    for (const entry of topLevel) {
      // Format title for toc-transformer: add " - " separator
      const formattedTitle = formatTitle(entry.title);

      // Fetch the title page to get child chapters
      const children = await this.fetchTitleChildren(sourceId, entry.htmlPath);

      result.push({
        id: entry.htmlPath,
        title: formattedTitle,
        level: guessLevel(entry.title),
        hasContent: children.length === 0, // Only has content if no children (e.g., standalone pages)
        children,
      });
    }

    return result;
  }

  private async fetchTitleChildren(sourceId: string, titleHtmlPath: string): Promise<RawTocNode[]> {
    const url = `${SITE_BASE}/${sourceId}/${titleHtmlPath}`;

    let html: string;
    try {
      html = await this.http.getHtml(url);
    } catch (err) {
      console.warn(`[codepublishing] Failed to fetch title page ${titleHtmlPath}: ${err}`);
      return [];
    }

    const $ = cheerio.load(html);
    const children: RawTocNode[] = [];

    // Chapter links: <p class="CHTOC"><a href="../NewportBeach01/NewportBeach0101.html#1.01">1.01  Adoption of Code</a></p>
    // Also handle other TOC levels: DIVTOC, ARTTOC, PTTOC
    const tocSelectors = 'p.CHTOC a, p.DIVTOC a, p.ARTTOC a, p.PTTOC a, p.SUBTOC a';

    $(tocSelectors).each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text) return;

      const resolvedPath = resolveHtmlPath(titleHtmlPath, href);
      if (!resolvedPath) return;

      const parentClass = $(el).parent().attr('class') || '';
      const level = tocClassToLevel(parentClass);
      const formattedTitle = formatChapterTitle(text, level);

      children.push({
        id: resolvedPath,
        title: formattedTitle,
        level,
        hasContent: true,
        children: [],
      });
    });

    return children;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const url = `${SITE_BASE}/${sourceId}/${sectionId}`;
    console.log(`[codepublishing] Fetching section ${sectionId}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    // Remove navigation elements
    $('#navTop, #navBottom, iframe, script, style').remove();

    // Extract content from mainContent div
    const mainContent = $('#mainContent');
    const contentHtml = mainContent.length ? mainContent.html() || html : $('body').html() || html;

    // Build canonical hash-bang URL for permalink
    const slug = sourceId.split('/')[1] || '';
    const relativePath = sectionId.replace(/^html\//, '');
    const sourceUrl = `${SITE_BASE}/${sourceId}/#!/${relativePath}`;

    return {
      html: contentHtml,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
    };
  }
}

// --- Helpers ---

/** Convert a jurisdiction name to a URL-safe slug: "Newport Beach" → "newport-beach" */
function toIdSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Infer jurisdiction type from name */
function inferType(name: string): 'city' | 'county' {
  const lower = name.toLowerCase();
  if (lower.includes('county')) return 'county';
  return 'city';
}

/**
 * Format a top-level title for toc-transformer compatibility.
 * "Title 1 GENERAL PROVISIONS" → "Title 1 - General Provisions"
 * "CHARTER OF THE CITY OF NEWPORT BEACH" → "Charter of the City of Newport Beach"
 */
function formatTitle(raw: string): string {
  // Try to split "Title N REST" or "CHARTER REST"
  const titleMatch = raw.match(/^(Title\s+\d+)\s+(.+)$/i);
  if (titleMatch) {
    return `${titleMatch[1]} - ${titleMatch[2]}`;
  }
  return raw;
}

/**
 * Format a chapter/division/article title for toc-transformer.
 * "1.01    Adoption of Code" → "Chapter 1.01 - Adoption of Code"
 * "A    General Provisions" → "Division A - General Provisions"
 */
function formatChapterTitle(raw: string, level: string): string {
  // Common format: "1.01    Title Here" with multiple spaces
  const match = raw.match(/^([\d.A-Z]+)\s{2,}(.+)$/i);
  if (match) {
    const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
    return `${levelLabel} ${match[1]} - ${match[2]}`;
  }
  // Already has a level prefix: "Chapter 1.01 ADOPTION OF CODE"
  const prefixMatch = raw.match(/^(Chapter|Article|Division|Part)\s+(.+)$/i);
  if (prefixMatch) {
    const rest = prefixMatch[2];
    const numHeading = rest.match(/^([\d.A-Z]+)\s+(.+)$/i);
    if (numHeading) {
      return `${prefixMatch[1]} ${numHeading[1]} - ${numHeading[2]}`;
    }
    return raw;
  }
  return raw;
}

/**
 * Resolve a relative href from a title page to an absolute path.
 * titleHtmlPath: "html/NewportBeach01/NewportBeach01.html"
 * href: "../NewportBeach01/NewportBeach0101.html#1.01"
 * → "html/NewportBeach01/NewportBeach0101.html"
 */
function resolveHtmlPath(titleHtmlPath: string, href: string): string | null {
  // Strip fragment
  const hrefNoFragment = href.split('#')[0];
  if (!hrefNoFragment) return null;

  // Get the directory of the title page
  const lastSlash = titleHtmlPath.lastIndexOf('/');
  const titleDir = lastSlash >= 0 ? titleHtmlPath.substring(0, lastSlash) : '';

  // Resolve relative path
  const parts = titleDir.split('/').filter(Boolean);
  const hrefParts = hrefNoFragment.split('/').filter(Boolean);

  for (const p of hrefParts) {
    if (p === '..') {
      parts.pop();
    } else if (p !== '.') {
      parts.push(p);
    }
  }

  return parts.join('/');
}

/** Guess the TOC level from the entry title text */
function guessLevel(title: string): string {
  const t = title.toLowerCase();
  if (t.startsWith('title ')) return 'title';
  if (t.startsWith('part ')) return 'part';
  if (t.startsWith('chapter ') || /^\d+\.\d+/.test(t)) return 'chapter';
  if (t.startsWith('article ')) return 'article';
  if (t.startsWith('division ')) return 'division';
  if (t.includes('charter')) return 'part';
  if (t.includes('statutory ref')) return 'part';
  if (t.includes('ordinance')) return 'part';
  return 'title';
}

/** Map Code Publishing CSS class to a TOC level */
function tocClassToLevel(className: string): string {
  if (className.includes('CHTOC')) return 'chapter';
  if (className.includes('ARTTOC')) return 'article';
  if (className.includes('DIVTOC')) return 'division';
  if (className.includes('PTTOC')) return 'part';
  if (className.includes('SUBTOC')) return 'section';
  return 'chapter';
}
