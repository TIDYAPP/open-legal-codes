import type { CrawlerAdapter } from './types.js';
import { MunicodeCrawler } from './municode.js';
import { AmlegalCrawler } from './amlegal.js';
import { Ecode360Crawler } from './ecode360.js';
import { EcfrCrawler } from './ecfr.js';
import { CaliforniaLeginfoCrawler } from './ca-leginfo.js';

/**
 * Get the appropriate crawler adapter for a given publisher name.
 */
export function getCrawler(publisherName: string): CrawlerAdapter {
  switch (publisherName) {
    case 'municode':
      return new MunicodeCrawler();
    case 'amlegal':
      return new AmlegalCrawler();
    case 'ecode360':
      return new Ecode360Crawler();
    case 'ecfr':
      return new EcfrCrawler();
    case 'ca-leginfo':
      return new CaliforniaLeginfoCrawler();
    default:
      throw new Error(`Unknown publisher: "${publisherName}". Available: municode, amlegal, ecode360, ecfr, ca-leginfo`);
  }
}

/**
 * List all available publisher names.
 */
export const PUBLISHERS = ['municode', 'amlegal', 'ecode360', 'ecfr', 'ca-leginfo'] as const;
