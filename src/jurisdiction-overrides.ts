import type { RegistryEntry } from './registry/types.js';
import type { Jurisdiction } from './types.js';

const NASHVILLE_TN_METRO_URL =
  'https://library.municode.com/tn/metro-government-of-nashville-and-davidson-county/codes/code_of_ordinances';
const TEXAS_LOCAL_GOVERNMENT_BAD_CRAWL_AT = '2026-03-17T21:24:31.661Z';

/**
 * Production has a bad cached AMLegal mapping for Nashville, TN that actually
 * serves Nashville, Illinois content. Point the city ID at the metro-government
 * Municode source instead so city lookups can recrawl against the correct code.
 */
export function applyRegistryOverrides(entry: RegistryEntry): RegistryEntry {
  if (entry.id === 'tn-nashville') {
    return {
      ...entry,
      publisher: 'municode',
      sourceId: '14243',
      sourceUrl: NASHVILLE_TN_METRO_URL,
      status: 'available',
    };
  }

  return entry;
}

/** Ignore known-bad cached jurisdictions so routes can trigger a corrective recrawl. */
export function isSuppressedCachedJurisdiction(jurisdiction: Jurisdiction | undefined): boolean {
  if (!jurisdiction) return false;

  if (
    jurisdiction.id === 'tn-nashville' &&
    jurisdiction.publisher.name === 'amlegal' &&
    jurisdiction.publisher.sourceId === 'nashville'
  ) {
    return true;
  }

  // Production cached an empty TOC for tx-lg on March 17, 2026 before the
  // Texas crawler was updated to the new TCSS headings API. Ignore that stale
  // artifact so the next lookup/toc request can trigger a corrective recrawl.
  return jurisdiction.id === 'tx-lg' &&
    jurisdiction.publisher.name === 'tx-statutes' &&
    jurisdiction.lastCrawled === TEXAS_LOCAL_GOVERNMENT_BAD_CRAWL_AT;
}
