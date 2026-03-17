import type { CrawlerAdapter } from './types.js';
import { MunicodeCrawler } from './municode.js';
import { AmlegalCrawler } from './amlegal.js';
import { Ecode360Crawler } from './ecode360.js';
import { EcfrCrawler } from './ecfr.js';
import { CaliforniaLeginfoCrawler } from './ca-leginfo.js';
import { NyOpenlegCrawler } from './ny-openleg.js';
import { FloridaStatutesCrawler } from './fl-statutes.js';
import { UscCrawler } from './usc.js';
import { TexasStatutesCrawler } from './tx-statutes.js';
import { ManualCrawler } from './manual.js';
import { createFallbackClient } from './browserbase-client.js';

/**
 * Get the appropriate crawler adapter for a given publisher name.
 * For amlegal and ecode360, uses a fallback client that tries plain HTTP
 * first and only switches to Browserbase if blocked (cheaper).
 */
export function getCrawler(publisherName: string): CrawlerAdapter {
  switch (publisherName) {
    case 'municode':
      return new MunicodeCrawler();
    case 'amlegal':
      return new AmlegalCrawler(createFallbackClient({ minDelayMs: 1000 }) as any);
    case 'ecode360':
      return new Ecode360Crawler(createFallbackClient({ minDelayMs: 500 }) as any);
    case 'ecfr':
      return new EcfrCrawler();
    case 'ca-leginfo':
      return new CaliforniaLeginfoCrawler();
    case 'ny-openleg':
      return new NyOpenlegCrawler();
    case 'fl-statutes':
      return new FloridaStatutesCrawler();
    case 'tx-statutes':
      return new TexasStatutesCrawler();
    case 'usc':
      return new UscCrawler();
    case 'manual':
      return new ManualCrawler();
    default:
      throw new Error(`Unknown publisher: "${publisherName}". Available: municode, amlegal, ecode360, ecfr, ca-leginfo, ny-openleg, fl-statutes, usc, tx-statutes, manual`);
  }
}

/**
 * List all available publisher names.
 */
export const PUBLISHERS = ['municode', 'amlegal', 'ecode360', 'ecfr', 'ca-leginfo', 'ny-openleg', 'fl-statutes', 'usc', 'tx-statutes', 'manual'] as const;
