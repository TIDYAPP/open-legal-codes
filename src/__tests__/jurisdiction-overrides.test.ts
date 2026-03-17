import { describe, expect, it } from 'vitest';
import { applyRegistryOverrides, isSuppressedCachedJurisdiction } from '../jurisdiction-overrides.js';
import type { RegistryEntry } from '../registry/types.js';
import type { Jurisdiction } from '../types.js';

describe('jurisdiction overrides', () => {
  it('rewrites Nashville, TN to the metro-government Municode source', () => {
    const entry: RegistryEntry = {
      id: 'tn-nashville',
      name: 'Nashville, TN',
      type: 'city',
      state: 'TN',
      fips: '4752006',
      lat: null,
      lng: null,
      population: null,
      publisher: 'amlegal',
      sourceId: 'nashville',
      sourceUrl: 'https://codelibrary.amlegal.com/codes/nashville/latest/overview',
      status: 'available',
      censusMatch: '4752006',
      lastScanned: '2026-03-17T00:00:00.000Z',
    };

    expect(applyRegistryOverrides(entry)).toMatchObject({
      id: 'tn-nashville',
      publisher: 'municode',
      sourceId: '14243',
      sourceUrl: 'https://library.municode.com/tn/metro-government-of-nashville-and-davidson-county/codes/code_of_ordinances',
    });
  });

  it('suppresses the bad cached Nashville AMLegal crawl but not the corrected cache', () => {
    const badCached: Jurisdiction = {
      id: 'tn-nashville',
      name: 'Nashville, TN',
      type: 'city',
      state: 'TN',
      parentId: 'tn',
      fips: '4752006',
      publisher: {
        name: 'amlegal',
        sourceId: 'nashville',
        url: 'https://codelibrary.amlegal.com/codes/nashville/latest/overview',
      },
      lastCrawled: '',
      lastUpdated: '',
    };

    const correctedCached: Jurisdiction = {
      ...badCached,
      publisher: {
        name: 'municode',
        sourceId: '14243',
        url: 'https://library.municode.com/tn/metro-government-of-nashville-and-davidson-county/codes/code_of_ordinances',
      },
    };

    expect(isSuppressedCachedJurisdiction(badCached)).toBe(true);
    expect(isSuppressedCachedJurisdiction(correctedCached)).toBe(false);
  });
});
