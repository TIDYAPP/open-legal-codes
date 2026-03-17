// Server-side: use API_URL env var (set in Vercel) or fall back to localhost.
// Client-side: use relative URLs so Next.js rewrites proxy to the backend.
const API_BASE = typeof window !== 'undefined' ? '' : (process.env.API_URL || 'http://localhost:3100');

async function apiFetch(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Jurisdiction {
  id: string;
  name: string;
  type: string;
  state: string | null;
  publisher: { name: string; sourceId: string; url: string };
  lastCrawled: string;
  lastUpdated: string;
}

export interface TocNode {
  slug: string;
  path: string;
  level: string;
  num: string;
  heading: string;
  hasContent: boolean;
  children?: TocNode[];
}

export interface TocTree {
  jurisdiction: string;
  title: string;
  children: TocNode[];
}

export interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
  url: string;
}

export async function getJurisdictions(state?: string): Promise<Jurisdiction[]> {
  const qs = state ? `?state=${state}` : '';
  const data = await apiFetch(`/api/v1/jurisdictions${qs}`);
  return data.data;
}

export interface LookupResult {
  status: 'ready' | 'crawling' | 'not_found';
  id?: string;
  name?: string;
  state?: string;
  type?: string;
  children?: TocNode[];
  progress?: { phase: string; total: number; completed: number };
  retryAfter?: number;
  lastCrawled?: string | null;
  publisher?: string | null;
  publisherUrl?: string | null;
  message?: string;
}

export async function lookupJurisdiction(state: string, slug: string, options?: { toc?: boolean }): Promise<LookupResult> {
  const includeToc = options?.toc !== false;
  const tocParam = includeToc ? '' : '&toc=false';
  const res = await fetch(`${API_BASE}/api/v1/lookup?slug=${encodeURIComponent(slug)}&state=${encodeURIComponent(state.toUpperCase())}${tocParam}`, { cache: 'no-store' });
  const json = await res.json();
  return json.data;
}

export async function getToc(id: string, depth?: number): Promise<TocTree> {
  const qs = depth ? `?depth=${depth}` : '';
  const data = await apiFetch(`/api/v1/jurisdictions/${id}/toc${qs}`);
  return data.data;
}

export async function getCodeText(
  id: string,
  path: string,
): Promise<{ text: string; num: string | null; heading: string | null; jurisdictionName: string }> {
  const data = await apiFetch(`/api/v1/jurisdictions/${id}/code/${path}`);
  return data.data;
}

export async function searchCode(
  id: string,
  query: string,
  limit = 20,
): Promise<{ results: SearchResult[]; total: number }> {
  const data = await apiFetch(`/api/v1/jurisdictions/${id}/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return data.data;
}

// --- Registry / Map ---

export interface GeoEntry {
  id: string;
  lat: number;
  lng: number;
  /** status: 'available' | 'cached' */
  s: string;
  /** publisher name */
  p: string;
  /** jurisdiction type */
  t: string;
  /** display name */
  n: string;
  /** state abbreviation */
  st: string | null;
  /** population */
  pop: number | null;
}

export interface RegistryStats {
  total: number;
  byPublisher: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byState: Record<string, number>;
}

export async function getRegistryGeo(): Promise<GeoEntry[]> {
  const data = await apiFetch('/api/v1/registry/geo');
  return data.data;
}

export async function getRegistryStats(): Promise<RegistryStats> {
  const data = await apiFetch('/api/v1/registry/stats');
  return data.data;
}

// --- Registry entries (full catalog) ---

export interface RegistryEntry {
  id: string;
  name: string;
  type: 'federal' | 'state' | 'county' | 'city' | 'hoa';
  state: string | null;
  publisher: string;
  sourceUrl: string;
  status: 'available' | 'cached' | 'discoverable';
  population: number | null;
}

export async function getRegistryEntries(): Promise<RegistryEntry[]> {
  const data = await apiFetch('/api/v1/registry');
  return data.data;
}
