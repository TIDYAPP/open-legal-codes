const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

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
}

export async function getJurisdictions(state?: string): Promise<Jurisdiction[]> {
  const qs = state ? `?state=${state}` : '';
  const data = await apiFetch(`/api/v1/jurisdictions${qs}`);
  return data.data;
}

export async function getJurisdiction(id: string): Promise<Jurisdiction> {
  const data = await apiFetch(`/api/v1/jurisdictions/${id}`);
  return data.data;
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
