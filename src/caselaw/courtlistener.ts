/**
 * CourtListener REST API client.
 *
 * Uses the full-text search endpoint to find court opinions
 * that cite specific statute sections.
 *
 * API docs: https://www.courtlistener.com/help/api/rest/
 * Rate limit: 5,000 requests/hour with token auth.
 */

import { HttpClient } from '../crawlers/http-client.js';
import type { CaseLawResult } from './types.js';

const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';

let client: HttpClient | null = null;

function getClient(): HttpClient {
  if (!client) {
    const token = process.env.COURTLISTENER_API_TOKEN;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Token ${token}`;
    }
    client = new HttpClient({
      minDelayMs: 750,
      timeoutMs: 15_000,
      headers,
    });
  }
  return client;
}

interface CourtListenerSearchResult {
  cluster_id: number;
  caseName: string;
  court: string;
  dateFiled: string;
  absoluteUrl: string;
  citation: string[];
  snippet: string;
  citeCount: number;
  status: string;
}

interface CourtListenerSearchResponse {
  count: number;
  results: CourtListenerSearchResult[];
}

/**
 * Search CourtListener for opinions matching a query.
 *
 * The query should be a quoted citation string like '"42 U.S.C. § 1983"'.
 * Multiple queries can be OR'd together.
 */
export async function searchCaseLaw(
  queries: string[],
  options?: { limit?: number; offset?: number },
): Promise<{ results: CaseLawResult[]; totalCount: number }> {
  if (!process.env.COURTLISTENER_API_TOKEN) {
    throw new Error(
      'COURTLISTENER_API_TOKEN is not set. ' +
      'Get a free API token at https://www.courtlistener.com/sign-in/ ' +
      'and set it in your environment.'
    );
  }

  if (queries.length === 0) {
    return { results: [], totalCount: 0 };
  }

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  // OR together all citation variants
  const query = queries.join(' OR ');

  const http = getClient();
  const params: Record<string, string> = {
    q: query,
    type: 'o',
    order_by: 'dateFiled desc',
    page_size: String(limit),
  };

  if (offset > 0) {
    // CourtListener uses page-based pagination
    const page = Math.floor(offset / limit) + 1;
    params.page = String(page);
  }

  const data = await http.getJson<CourtListenerSearchResponse>(
    `${COURTLISTENER_BASE}/search/`,
    params,
  );

  const results: CaseLawResult[] = data.results.map((r) => ({
    clusterId: r.cluster_id,
    caseName: r.caseName || 'Unknown Case',
    court: r.court || 'Unknown Court',
    dateFiled: r.dateFiled || '',
    url: r.absoluteUrl
      ? `https://www.courtlistener.com${r.absoluteUrl}`
      : `https://www.courtlistener.com/opinion/${r.cluster_id}/`,
    snippet: r.snippet || '',
    citation: Array.isArray(r.citation) ? r.citation[0] || '' : '',
    citeCount: r.citeCount || 0,
  }));

  return {
    results,
    totalCount: data.count || 0,
  };
}
