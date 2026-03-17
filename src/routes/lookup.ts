import { Hono } from 'hono';
import type { Context } from 'hono';
import { store } from '../store/index.js';
import type { Jurisdiction } from '../types.js';
import type { RegistryEntry } from '../registry/types.js';
import { registryStore } from '../registry/store.js';
import { crawlTracker } from '../crawl-tracker.js';
import { triggerAutoCrawl } from '../auto-crawl.js';
import { discoverPublisher } from '../registry/publisher-discovery.js';

export const lookupRoutes = new Hono();

/** Build the standard "ready" response for a cached jurisdiction. */
function readyResponse(c: Context, jurisdiction: Jurisdiction, includeToc = true) {
  const toc = includeToc ? store.getToc(jurisdiction.id) : null;
  return c.json({
    data: {
      status: 'ready',
      id: jurisdiction.id,
      name: jurisdiction.name,
      state: jurisdiction.state,
      type: jurisdiction.type,
      children: toc?.children || [],
      lastCrawled: jurisdiction.lastCrawled || null,
      publisher: jurisdiction.publisher?.name || null,
      publisherUrl: jurisdiction.publisher?.url || null,
    },
  });
}

/** Check crawl status, check fresh cache, or trigger auto-crawl. Returns a 202 response. */
function crawlingOrTrigger(c: Context, entry: RegistryEntry, includeToc = true) {
  const crawlStatus = crawlTracker.getStatus(entry.id);
  if (crawlStatus) {
    return c.json({
      data: {
        status: 'crawling',
        name: entry.name,
        type: entry.type,
        progress: {
          phase: crawlStatus.progress.phase,
          total: crawlStatus.progress.total,
          completed: crawlStatus.progress.completed,
        },
        retryAfter: 15,
      },
    }, 202);
  }

  // Check if it became cached since server start
  const freshCached = store.getJurisdiction(entry.id);
  if (freshCached) {
    return readyResponse(c, freshCached, includeToc);
  }

  triggerAutoCrawl(entry);
  return c.json({
    data: {
      status: 'crawling',
      name: entry.name,
      type: entry.type,
      progress: { phase: 'toc', total: 0, completed: 0 },
      retryAfter: 15,
    },
  }, 202);
}

/** Try to resolve a discoverable (census-only) entry to a real publisher. Returns null if no publisher found. */
async function tryDiscover(entry: RegistryEntry, state: string, type?: 'county' | 'city'): Promise<RegistryEntry | null> {
  if (entry.status !== 'discoverable') return entry;
  const name = entry.name.replace(/,\s*[A-Z]{2}$/, '');
  const discovered = await discoverPublisher(name, state, {
    fips: entry.fips || undefined,
    lat: entry.lat || undefined,
    lng: entry.lng || undefined,
    population: entry.population || undefined,
    ...(type ? { type } : {}),
  });
  return discovered || null;
}

lookupRoutes.get('/', async (c) => {
  const slug = c.req.query('slug');
  let city = c.req.query('city');
  const county = c.req.query('county');
  let state = c.req.query('state');
  const address = c.req.query('address');
  const includeToc = c.req.query('toc') !== 'false';

  // Parse address to extract city + state if provided
  if (address && !city && !slug) {
    const parsed = parseAddress(address);
    if (parsed) {
      city = parsed.city;
      state = state || parsed.state;
    }
  }

  if (!state) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'state parameter is required (or provide a full address)' } }, 400);
  }
  if (!slug && !city && !county) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'slug, city, county, or address parameter is required' } }, 400);
  }

  // --- Resolve the jurisdiction ---

  // Try slug-based lookup first (from frontend URLs like /ca/palm-desert)
  if (slug) {
    // Check if cached in store (try to find by slug match)
    const storeResults = store.listJurisdictions({ state });
    const cachedMatch = storeResults.find(j => toSlug(j.name) === slug);
    if (cachedMatch) return readyResponse(c, cachedMatch, includeToc);

    // Check registry
    let registryEntry = registryStore.getBySlug(state, slug);
    if (registryEntry) {
      const resolved = await tryDiscover(registryEntry, state);
      if (!resolved) {
        return c.json({ data: { status: 'not_found', message: 'No online legal code found for this jurisdiction' } });
      }
      return crawlingOrTrigger(c, resolved, includeToc);
    }

    return c.json({ data: { status: 'not_found' } });
  }

  // City-based lookup (for API/agent consumers)
  if (city) {
    const cityLower = city.toLowerCase();

    // Check cached store first
    const storeResults = store.listJurisdictions({ state });
    const cachedMatch = storeResults.find(j => j.name.toLowerCase().includes(cityLower));
    if (cachedMatch) return readyResponse(c, cachedMatch, includeToc);

    // Check registry (includes census fallback)
    const registryResults = registryStore.findByName(city, state);
    if (registryResults.length > 0) {
      const resolved = await tryDiscover(registryResults[0], state);
      if (!resolved) {
        return c.json({ data: { status: 'not_found', message: 'No online legal code found for this jurisdiction' } });
      }
      return crawlingOrTrigger(c, resolved, includeToc);
    }

    return c.json({ data: { status: 'not_found' } });
  }

  // County-based lookup
  if (county) {
    const countyLower = county.toLowerCase();

    // Check cached store first
    const storeResults = store.listJurisdictions({ state, type: 'county' });
    const cachedMatch = storeResults.find(j => j.name.toLowerCase().includes(countyLower));
    if (cachedMatch) return readyResponse(c, cachedMatch, includeToc);

    // Check registry — search for county name, filter to county type
    const registryResults = registryStore.findByName(county, state)
      .filter(e => e.type === 'county');
    if (registryResults.length > 0) {
      const resolved = await tryDiscover(registryResults[0], state, 'county');
      if (!resolved) {
        return c.json({ data: { status: 'not_found', message: 'No online legal code found for this county' } });
      }
      return crawlingOrTrigger(c, resolved, includeToc);
    }

    return c.json({ data: { status: 'not_found' } });
  }

  return c.json({ data: { status: 'not_found' } });
});

// --- Address parsing ---

const STATE_ABBREVS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

const VALID_STATE_CODES = new Set(Object.values(STATE_ABBREVS));

/**
 * Parse a US address string to extract city and state.
 * Handles formats like:
 *   "306 Desert Falls East, Palm Desert, CA"
 *   "306 desert falls east palm desert ca 92260"
 *   "2584 Fairway Dr, Costa Mesa, CA"
 *   "Palm Desert, California"
 */
function parseAddress(address: string): { city: string; state: string } | null {
  const trimmed = address.trim();

  // Try comma-separated: "..., City, ST [zip]"
  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    // Last part should contain state (and possibly zip)
    const lastPart = parts[parts.length - 1];
    const stateFromLast = extractState(lastPart);
    if (stateFromLast) {
      // City is the second-to-last part
      const city = parts[parts.length - 2];
      if (city) return { city, state: stateFromLast };
    }
  }

  // No commas or commas didn't work — try to find state at end of string
  // Remove zip code if present
  const noZip = trimmed.replace(/\s+\d{5}(-\d{4})?$/, '');
  const words = noZip.split(/\s+/);

  // Check last 1-2 words for state
  if (words.length >= 2) {
    // Try last word as state abbreviation
    const lastWord = words[words.length - 1];
    if (lastWord.length === 2 && VALID_STATE_CODES.has(lastWord.toUpperCase())) {
      // Everything between the street number and state is potential city
      // Try to extract city: skip leading numbers/street parts, take remaining words before state
      const city = extractCityFromWords(words.slice(0, -1));
      if (city) return { city, state: lastWord.toUpperCase() };
    }

    // Try last two words as state name (e.g., "new york", "north carolina")
    if (words.length >= 3) {
      const twoWordState = `${words[words.length - 2]} ${words[words.length - 1]}`.toLowerCase();
      const stateCode = STATE_ABBREVS[twoWordState];
      if (stateCode) {
        const city = extractCityFromWords(words.slice(0, -2));
        if (city) return { city, state: stateCode };
      }
    }

    // Try last word as full state name
    const oneWordState = STATE_ABBREVS[lastWord.toLowerCase()];
    if (oneWordState) {
      const city = extractCityFromWords(words.slice(0, -1));
      if (city) return { city, state: oneWordState };
    }
  }

  return null;
}

/** Extract a state abbreviation from a string like "CA 92260" or "California" */
function extractState(s: string): string | null {
  const clean = s.trim().replace(/\s+\d{5}(-\d{4})?$/, ''); // strip zip
  if (clean.length === 2 && VALID_STATE_CODES.has(clean.toUpperCase())) {
    return clean.toUpperCase();
  }
  return STATE_ABBREVS[clean.toLowerCase()] || null;
}

/**
 * Given words from an address (minus state), try to guess the city.
 * Strategy: skip the leading street number + street name, take the rest.
 * If that fails, just return the last 1-3 non-numeric words.
 */
function extractCityFromWords(words: string[]): string | null {
  if (words.length === 0) return null;

  // If first word is a number (street address), skip it and common street words
  const STREET_SUFFIXES = new Set([
    'st', 'street', 'ave', 'avenue', 'blvd', 'boulevard', 'dr', 'drive',
    'ln', 'lane', 'rd', 'road', 'ct', 'court', 'pl', 'place', 'way',
    'cir', 'circle', 'pkwy', 'parkway', 'hwy', 'highway', 'tr', 'trail',
    'east', 'west', 'north', 'south', 'e', 'w', 'n', 's',
  ]);

  if (/^\d+$/.test(words[0])) {
    // Find where the street name ends (after a street suffix or directional)
    let streetEnd = 1; // at least skip the number
    for (let i = 1; i < words.length; i++) {
      if (STREET_SUFFIXES.has(words[i].toLowerCase())) {
        streetEnd = i + 1;
        break;
      }
    }
    // If no suffix found, assume street is just the number + next word
    if (streetEnd === 1 && words.length > 2) {
      streetEnd = 2;
    }
    const cityWords = words.slice(streetEnd);
    if (cityWords.length > 0) {
      return cityWords.join(' ');
    }
  }

  // No street number — just return all words as the city
  return words.join(' ');
}

// Helper functions
function stripPrefix(name: string): string {
  return name.replace(/^(City of|Town of|Village of|County of|Borough of)\s+/i, '');
}

function stripStateSuffix(name: string): string {
  // Remove ", CA" or ", NJ" etc. from end of name
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toSlug(name: string): string {
  return slugify(stripStateSuffix(stripPrefix(name)));
}
