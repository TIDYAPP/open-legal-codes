/**
 * Census Loader — downloads and parses US Census Bureau gazetteer files
 * to get geographic coordinates and population for every state, county, and place.
 *
 * Data source: Census Bureau Gazetteer Files
 * https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
 *
 * Output: data/census-places.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export interface CensusPlace {
  /** GEOID (FIPS code) */
  fips: string;
  /** Place name */
  name: string;
  /** 2-letter state abbreviation */
  state: string;
  /** Classification */
  type: 'state' | 'county' | 'place';
  /** Latitude centroid */
  lat: number;
  /** Longitude centroid */
  lng: number;
  /** Population (from census or estimate) */
  pop: number;
}

const GAZETTEER_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';

const GAZETTEER_FILES = {
  state: '2024_Gaz_state_national.zip',
  counties: '2024_Gaz_counties_national.zip',
  places: '2024_Gaz_place_national.zip',
} as const;

// FIPS state code to abbreviation mapping
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
  // Territories
  '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};

export interface CensusLoaderOptions {
  dataDir?: string;
  onProgress?: (msg: string) => void;
}

/**
 * Download Census gazetteer files and parse them into a unified places list.
 */
export async function loadCensusData(options: CensusLoaderOptions = {}): Promise<CensusPlace[]> {
  const dataDir = options.dataDir || join(process.cwd(), 'data');
  const cacheDir = join(dataDir, 'census');
  const log = options.onProgress || console.log;

  mkdirSync(cacheDir, { recursive: true });

  const places: CensusPlace[] = [];

  // Download and parse each gazetteer file
  for (const [type, filename] of Object.entries(GAZETTEER_FILES)) {
    const zipPath = join(cacheDir, filename);
    const tsvPath = zipPath.replace('.zip', '.txt');

    // Download if not cached
    if (!existsSync(tsvPath)) {
      const url = `${GAZETTEER_BASE}/${filename}`;
      log(`[census] Downloading ${url}...`);
      await downloadAndExtract(url, zipPath, tsvPath);
      log(`[census] Extracted ${filename}`);
    } else {
      log(`[census] Using cached ${filename}`);
    }

    // Parse TSV
    const tsv = readFileSync(tsvPath, 'utf-8');
    const lines = tsv.trim().split('\n');
    const header = lines[0].split('\t').map(h => h.trim());

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t').map(c => c.trim());
      const row: Record<string, string> = {};
      for (let j = 0; j < header.length; j++) {
        row[header[j]] = cols[j] || '';
      }

      const place = parseRow(row, type as 'state' | 'counties' | 'places');
      if (place) places.push(place);
    }

    log(`[census] Parsed ${type}: ${lines.length - 1} entries`);
  }

  // Write output
  const outputPath = join(dataDir, 'census-places.json');
  writeFileSync(outputPath, JSON.stringify(places, null, 2));
  log(`[census] Wrote ${places.length} places to ${outputPath}`);

  return places;
}

function parseRow(row: Record<string, string>, fileType: 'state' | 'counties' | 'places'): CensusPlace | null {
  // Column names vary slightly between files
  const geoid = row['GEOID'] || row['GEOID_LC'] || '';
  const usps = row['USPS'] || '';
  const name = row['NAME'] || '';
  const lat = parseFloat(row['INTPTLAT'] || '');
  const lng = parseFloat(row['INTPTLONG'] || row['INTPTLON'] || '');
  const pop = parseInt(row['POP'] || row['POPPT'] || row['ESTIMATESBASE2020'] || '0', 10);

  if (!geoid || isNaN(lat) || isNaN(lng)) return null;

  // Determine state abbreviation
  let state = usps;
  if (!state) {
    // Extract state FIPS from GEOID (first 2 digits)
    const stateFips = geoid.substring(0, 2);
    state = FIPS_TO_STATE[stateFips] || '';
  }
  if (!state) return null;

  let type: 'state' | 'county' | 'place';
  switch (fileType) {
    case 'state': type = 'state'; break;
    case 'counties': type = 'county'; break;
    case 'places': type = 'place'; break;
  }

  return {
    fips: geoid,
    name: cleanName(name),
    state,
    type,
    lat,
    lng,
    pop: isNaN(pop) ? 0 : pop,
  };
}

/** Strip common suffixes like "city", "town", "CDP" from Census place names */
function cleanName(name: string): string {
  return name
    .replace(/ city$/i, '')
    .replace(/ town$/i, '')
    .replace(/ CDP$/i, '')
    .replace(/ borough$/i, '')
    .replace(/ village$/i, '')
    .replace(/ municipality$/i, '')
    .trim();
}

async function downloadAndExtract(url: string, zipPath: string, tsvPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const { execSync } = await import('node:child_process');

  // Write zip to disk
  writeFileSync(zipPath, buffer);

  // Extract — the zip contains a single .txt file with a matching name
  execSync(`unzip -o -d "${join(zipPath, '..')}" "${zipPath}"`, { stdio: 'pipe' });

  // The extracted file should match tsvPath directly (same base name, .zip → .txt)
  if (!existsSync(tsvPath)) {
    throw new Error(`Expected ${tsvPath} after extracting ${zipPath}, but file not found`);
  }
}
