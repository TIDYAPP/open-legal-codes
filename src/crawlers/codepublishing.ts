import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://www.codepublishing.com';

/**
 * Code Publishing Crawler Adapter
 *
 * Code Publishing (now part of General Code / ICC) hosts municipal codes
 * with a clean static HTML structure — no API needed, just HTML scraping.
 *
 * URL patterns:
 *   Main page:    https://www.codepublishing.com/{STATE}/{CITY}/
 *   Title TOC:    https://www.codepublishing.com/{STATE}/{CITY}/html/{TitleId}/{TitleId}.html
 *   Chapter page: https://www.codepublishing.com/{STATE}/{CITY}/html/{TitleId}/{ChapterId}.html
 *   Charter:      https://www.codepublishing.com/{STATE}/{CITY}/html/{City}CH.html
 *
 * HTML structure:
 *   Main page:  p.tocItem > a[href] — links to title pages
 *   Title page: p.CHTOC > a[href] — links to chapter pages
 *   Chapter page: h3.Cite (section headings), p.P1 (content paragraphs)
 *   Section IDs: id="1.01.010" on h3.Cite elements
 *
 * The sourceId for this adapter is the path segment: "{STATE}/{CITY}" (e.g., "CA/NewportBeach").
 */
export class CodepublishingCrawler implements CrawlerAdapter {
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

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    // Code Publishing doesn't have a discoverable jurisdiction list.
    // Jurisdictions are registered in the registry with publisher=codepublishing.
    console.warn('[codepublishing] listJurisdictions not supported — jurisdictions are discovered via registry.');
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    // sourceId is like "CA/NewportBeach"
    const mainUrl = `${SITE_BASE}/${sourceId}/`;
    const mainHtml = await this.http.getHtml(mainUrl);
    const $ = cheerio.load(mainHtml);

    const titles: RawTocNode[] = [];

    // Extract top-level titles from p.tocItem links
    for (const el of $('p.tocItem').toArray()) {
      const $el = $(el);
      const $link = $el.find('a[href]');
      if (!$link.length) continue;

      const titleText = $link.text().trim();
      if (!titleText) continue;

      // Extract the HTML path from the checkbox value like "html/NewportBeach01/NewportBeach01.html"
      const $checkbox = $el.find('input[type="checkbox"]');
      const htmlPath = $checkbox.attr('value') || '';
      if (!htmlPath) continue;

      // htmlPath is like "html/NewportBeach01/NewportBeach01.html" or "html/NewportBeachCH.html"
      const titleId = htmlPath.replace(/^html\//, '').replace(/\.html$/, '');

      // Determine if this title has expandable children (has the + button with class 'ajx')
      const hasChildren = $el.find('.ajx').length > 0;

      const titleNode: RawTocNode = {
        id: titleId,
        title: titleText,
        level: titleText.match(/^Title\s/i) ? 'title' : titleText.match(/^charter/i) ? 'part' : 'title',
        hasContent: !hasChildren, // reserved titles with no children have content directly
        children: [],
      };

      // If this title has children, fetch the title page to get chapters
      if (hasChildren) {
        try {
          const titlePageUrl = `${SITE_BASE}/${sourceId}/${htmlPath}`;
          titleNode.children = await this.fetchTitleChildren(titlePageUrl, sourceId);
        } catch (err) {
          console.warn(`[codepublishing] Failed to fetch title children for ${titleId}: ${err}`);
        }
      }

      titles.push(titleNode);
    }

    return titles;
  }

  private async fetchTitleChildren(titlePageUrl: string, _sourceId: string): Promise<RawTocNode[]> {
    const html = await this.http.getHtml(titlePageUrl);
    const $ = cheerio.load(html);
    const children: RawTocNode[] = [];

    // Chapter links are in p.CHTOC elements
    for (const el of $('p.CHTOC').toArray()) {
      const $link = $(el).find('a[href]');
      if (!$link.length) continue;

      const href = $link.attr('href') || '';
      const text = $link.text().trim();
      if (!text) continue;

      // href is like "../NewportBeach01/NewportBeach0101.html#1.01"
      // Extract the chapter file path
      const match = href.match(/\.\.\/(.+\.html)/);
      if (!match) continue;

      const chapterPath = match[1]; // "NewportBeach01/NewportBeach0101.html"
      const chapterId = chapterPath.replace(/\.html.*$/, ''); // "NewportBeach01/NewportBeach0101"

      children.push({
        id: chapterId,
        title: text,
        level: 'chapter',
        hasContent: true,
        children: [],
      });
    }

    return children;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // sectionId is like "NewportBeach01/NewportBeach0101" (chapter path without .html)
    // or like "NewportBeachCH" for the charter
    const url = `${SITE_BASE}/${sourceId}/html/${sectionId}.html`;
    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);

    // Extract content from #mainContent, excluding navigation
    const $content = $('#mainContent');
    if (!$content.length) {
      return {
        html: html,
        fetchedAt: new Date().toISOString(),
        sourceUrl: `${SITE_BASE}/${sourceId}/#!/${sectionId}.html`,
      };
    }

    return {
      html: $content.html() || '',
      fetchedAt: new Date().toISOString(),
      sourceUrl: `${SITE_BASE}/${sourceId}/#!/${sectionId}.html`,
    };
  }
}
