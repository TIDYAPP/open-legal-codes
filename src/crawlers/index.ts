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
import { NcStatutesCrawler } from './nc-statutes.js';
import { VaStatutesCrawler } from './va-statutes.js';
import { WaStatutesCrawler } from './wa-statutes.js';
import { OhStatutesCrawler } from './oh-statutes.js';
import { MaStatutesCrawler } from './ma-statutes.js';
import { IlStatutesCrawler } from './il-statutes.js';
import { PaStatutesCrawler } from './pa-statutes.js';
import { NjStatutesCrawler } from './nj-statutes.js';
import { GaStatutesCrawler } from './ga-statutes.js';
import { CoStatutesCrawler } from './co-statutes.js';
import { ArizonaStatutesCrawler } from './az-statutes.js';
import { TnStatutesCrawler } from './tn-statutes.js';
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
    case 'nc-statutes':
      return new NcStatutesCrawler();
    case 'va-statutes':
      return new VaStatutesCrawler();
    case 'wa-statutes':
      return new WaStatutesCrawler();
    case 'oh-statutes':
      return new OhStatutesCrawler();
    case 'ma-statutes':
      return new MaStatutesCrawler();
    case 'il-statutes':
      return new IlStatutesCrawler();
    case 'pa-statutes':
      return new PaStatutesCrawler();
    case 'nj-statutes':
      return new NjStatutesCrawler();
    case 'ga-statutes':
      return new GaStatutesCrawler();
    case 'co-statutes':
      return new CoStatutesCrawler();
    case 'az-statutes':
      return new ArizonaStatutesCrawler();
    case 'tn-statutes':
      return new TnStatutesCrawler(createFallbackClient({ minDelayMs: 2000 }));
    default:
      throw new Error(
        `Unknown publisher: "${publisherName}". Available: municode, amlegal, ecode360, ecfr, ca-leginfo, ny-openleg, fl-statutes, usc, tx-statutes, manual, nc-statutes, va-statutes, wa-statutes, oh-statutes, ma-statutes, il-statutes, pa-statutes, nj-statutes, ga-statutes, co-statutes, az-statutes, tn-statutes`,
      );
  }
}

/**
 * List all available publisher names.
 */
export const PUBLISHERS = [
  'municode',
  'amlegal',
  'ecode360',
  'ecfr',
  'ca-leginfo',
  'ny-openleg',
  'fl-statutes',
  'usc',
  'tx-statutes',
  'manual',
  'nc-statutes',
  'va-statutes',
  'wa-statutes',
  'oh-statutes',
  'ma-statutes',
  'il-statutes',
  'pa-statutes',
  'nj-statutes',
  'ga-statutes',
  'co-statutes',
  'az-statutes',
  'tn-statutes',
] as const;
