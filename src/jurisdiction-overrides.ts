import type { RegistryEntry } from './registry/types.js';
import type { Jurisdiction } from './types.js';

const NASHVILLE_TN_METRO_URL =
  'https://library.municode.com/tn/metro-government-of-nashville-and-davidson-county/codes/code_of_ordinances';

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

  return jurisdiction.id === 'tn-nashville' &&
    jurisdiction.publisher.name === 'amlegal' &&
    jurisdiction.publisher.sourceId === 'nashville';
}
