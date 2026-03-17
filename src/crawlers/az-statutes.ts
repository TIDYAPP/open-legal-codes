import type { CrawlerAdapter, RawContent, RawTocNode } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';
import * as cheerio from 'cheerio';

const SITE_BASE = 'https://www.azleg.gov';

export const AZ_TITLES = [
  { number: '9', slug: 'title-9', name: 'Cities and Towns' },
  { number: '11', slug: 'title-11', name: 'Counties' },
  { number: '42', slug: 'title-42', name: 'Taxation' },
] as const;

/**
 * Arizona Revised Statutes
 *
 * This adapter focuses on the two Arizona titles that matter for local
 * government coverage:
 *   - Title 9: Cities and Towns
 *   - Title 11: Counties
 *
 * URL patterns:
 *   Index:   /arstitle/
 *   TOC:     /arsDetail?title={N}
 *   Section: /ars/{N}/{section-file}.htm
 *
 * sectionId is stored as an absolute azleg.gov /ars/... URL.
 */
export class ArizonaStatutesCrawler implements CrawlerAdapter {
  readonly publisherName = 'az-statutes' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({
      minDelayMs: 1500,
      userAgent: 'Mozilla/5.0 (compatible; OpenLegalCodes/0.1)',
    });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    for (const title of AZ_TITLES) {
      yield {
        id: `az-${title.slug}`,
        name: `Arizona Title ${title.number} - ${title.name}`,
        type: 'state',
        state: 'AZ',
        parentId: 'az',
        fips: '04',
        publisher: {
          name: 'az-statutes',
          sourceId: title.number,
          url: `${SITE_BASE}/arsDetail?title=${title.number}`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const tocUrl = `${SITE_BASE}/arsDetail?title=${encodeURIComponent(sourceId)}`;
    console.log(`[az-statutes] Fetching TOC for title ${sourceId} from ${tocUrl}`);

    const html = await this.http.getHtml(tocUrl);
    const $ = cheerio.load(html);
    return parseTitleToc($);
  }

  async fetchSection(_sourceId: string, sectionId: string): Promise<RawContent> {
    const url = sectionId.startsWith('http')
      ? sectionId
      : `${SITE_BASE}${sectionId.startsWith('/') ? '' : '/'}${sectionId}`;

    console.log(`[az-statutes] Fetching ${sectionId} from ${url}`);

    const html = await this.http.getHtml(url);
    const $ = cheerio.load(html);
    const cleanHtml = extractContent($);

    return {
      html: cleanHtml || html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
    };
  }
}

function parseTitleToc($: cheerio.CheerioAPI): RawTocNode[] {
  const chapters: RawTocNode[] = [];

  $('div.accordion').each((_i, chapterEl) => {
    const chapter = $(chapterEl);
    const heading = chapter.children('h5').first();
    const chapterLabel = cleanText(heading.find('a').first().text());
    const chapterName = cleanText(heading.find('div.two-thirds').first().text());
    const chapterRange = cleanText(heading.find('div.one-sixth').last().text());

    const chapterTitle = [chapterLabel, chapterName].filter(Boolean).join(' - ') || chapterLabel || chapterName;
    const chapterNode: RawTocNode = {
      id: chapterId(chapterLabel || chapterRange || `chapter-${chapters.length + 1}`),
      title: chapterRange ? `${chapterTitle} (${chapterRange})` : chapterTitle,
      level: 'chapter',
      hasContent: false,
      children: [],
    };

    chapter.children('div').first().children('div.article').each((_j, articleEl) => {
      const article = $(articleEl);
      const articleLabel = cleanText(article.children('a').first().text());
      const articleName = cleanText(article.children('span').first().text());
      const articleTitle = [articleLabel, articleName].filter(Boolean).join(' - ') || articleLabel || articleName;

      const articleNode: RawTocNode = {
        id: articleId(chapterNode.id, articleLabel || `article-${chapterNode.children.length + 1}`),
        title: articleTitle,
        level: 'article',
        hasContent: false,
        children: [],
      };

      article.find('ul').each((_k, listEl) => {
        const link = $(listEl).find('a.stat').first();
        const href = link.attr('href') || '';
        const num = cleanText(link.text());
        const headingText = cleanText($(listEl).find('li.colright').first().text());
        const sourceUrl = extractSectionUrl(href);

        if (!sourceUrl || !num) return;

        articleNode.children.push({
          id: sourceUrl,
          title: `${num}${headingText ? ` - ${headingText}` : ''}`,
          level: 'section',
          hasContent: true,
          children: [],
        });
      });

      if (articleNode.children.length > 0) {
        chapterNode.children.push(articleNode);
      }
    });

    if (chapterNode.children.length > 0) {
      chapters.push(chapterNode);
    }
  });

  return chapters;
}

function extractSectionUrl(href: string): string | null {
  if (!href) return null;

  const absolute = new URL(href, SITE_BASE);
  const docName = absolute.searchParams.get('docName');
  if (docName) return docName;

  return absolute.toString();
}

function extractContent($: cheerio.CheerioAPI): string {
  $('script, style, nav, header, footer, noscript').remove();

  const body = $('body').first();
  const html = body.html() || '';
  return html;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function chapterId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function articleId(chapter: string, article: string): string {
  const articleSlug = article.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${chapter}-${articleSlug}`;
}
