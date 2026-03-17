import type { Jurisdiction } from './types.js';
import { store } from './store/index.js';
import { isSuppressedCachedJurisdiction } from './jurisdiction-overrides.js';

export function isUsableCachedJurisdiction(jurisdiction: Jurisdiction | undefined): jurisdiction is Jurisdiction {
  return !!jurisdiction &&
    !isSuppressedCachedJurisdiction(jurisdiction) &&
    store.hasUsableToc(jurisdiction.id);
}

export function getUsableCachedJurisdiction(id: string): Jurisdiction | undefined {
  const jurisdiction = store.getJurisdiction(id);
  return isUsableCachedJurisdiction(jurisdiction) ? jurisdiction : undefined;
}
