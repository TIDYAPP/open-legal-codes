import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';

/**
 * American Legal Publishing Crawler Adapter
 *
 * amlegal.com is an Angular SPA — requires Playwright for content extraction.
 * URL pattern: codelibrary.amlegal.com/codes/{slug}/latest/{code}/{nodeId}
 * Content selectors: .ntxt, .codes-content, .akn-act, .code-content
 *
 * TODO: Implement with Playwright
 */
export class AmlegalCrawler implements CrawlerAdapter {
  readonly publisherName = 'amlegal' as const;

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    // TODO: Crawl amlegal code library listing
    throw new Error('Not implemented');
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    // TODO: Navigate to code root, extract sidebar TOC tree
    throw new Error('Not implemented');
  }

  async fetchSection(_sourceId: string, _sectionId: string): Promise<RawContent> {
    // TODO: Navigate to section URL, wait for Angular render, extract content
    throw new Error('Not implemented');
  }
}
