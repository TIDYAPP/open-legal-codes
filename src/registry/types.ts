// ---------------------------------------------------------------------------
// Registry — comprehensive catalog of all discoverable jurisdictions
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  /** URL-safe slug, matches Jurisdiction.id format */
  id: string;
  /** Display name */
  name: string;
  type: 'federal' | 'state' | 'county' | 'city' | 'hoa';
  /** Two-letter state code, null for federal */
  state: string | null;
  /** FIPS code from Census cross-reference */
  fips: string | null;
  /** Latitude from Census gazetteer */
  lat: number | null;
  /** Longitude from Census gazetteer */
  lng: number | null;
  /** Population from Census */
  population: number | null;
  /** Publisher adapter name */
  publisher: string;
  /** Publisher's internal ID */
  sourceId: string;
  /** Canonical URL on publisher site */
  sourceUrl: string;
  /** Whether we've cached content for this jurisdiction */
  status: 'available' | 'cached';
  /** FIPS or Census ID that was matched */
  censusMatch: string | null;
  /** ISO timestamp when publisher catalog was scanned */
  lastScanned: string;
}

export interface RegistryStats {
  total: number;
  byPublisher: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byState: Record<string, number>;
}
