import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';

/**
 * Municode Crawler Adapter
 *
 * Uses Municode's JSON API at api.municode.com:
 * - GET /codesToc/children — walk TOC tree
 * - GET /CodesContent — get HTML content for a section
 * - GET /Clients/stateAbbr — list all clients in a state
 *
 * No browser needed — all endpoints return JSON or server-rendered HTML.
 *
 * TODO: Implement
 */
export class MunicodeCrawler implements CrawlerAdapter {
  readonly publisherName = 'municode' as const;

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    // TODO: GET https://library.municode.com/api/ClientCodes?stateId=XX
    throw new Error('Not implemented');
  }

  async fetchToc(_sourceId: string): Promise<RawTocNode[]> {
    // TODO: Recursively walk GET https://api.municode.com/codesToc/children
    throw new Error('Not implemented');
  }

  async fetchSection(_sourceId: string, _sectionId: string): Promise<RawContent> {
    // TODO: GET https://api.municode.com/CodesContent
    throw new Error('Not implemented');
  }
}
