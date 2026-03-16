// Open Legal Codes — API Client
// Thin HTTP client wrapping the REST API. Uses native fetch (Node 18+).

const DEFAULT_BASE_URL = 'https://openlegalcodes.org/api/v1';

export interface Jurisdiction {
  id: string;
  name: string;
  type: string;
  state: string | null;
  publisher: { name: string; sourceId: string; url: string };
}

export interface TocNode {
  path: string;
  num: string;
  heading?: string;
  hasContent: boolean;
  children?: TocNode[];
}

export interface CodeSection {
  jurisdiction: string;
  jurisdictionName: string;
  path: string;
  num: string;
  heading: string;
  text: string;
  url: string;
}

export interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
  url: string;
}

export interface CrawlingResponse {
  crawling: true;
  retryAfter: number;
}

function isCrawling(value: unknown): value is CrawlingResponse {
  return typeof value === 'object' && value !== null && 'crawling' in value;
}

export type ApiResult<T> = T | CrawlingResponse;

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || process.env.OPEN_LEGAL_CODES_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async request<T>(path: string, query?: Record<string, string | undefined>): Promise<ApiResult<T>> {
    const url = new URL(path, this.baseUrl + '/');
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    const response = await fetch(url.toString());

    if (response.status === 202) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '30', 10);
      return { crawling: true, retryAfter } as CrawlingResponse;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API error ${response.status} ${response.statusText} for ${url.pathname}: ${body}`);
    }

    const json = await response.json() as { data: T; meta?: unknown };
    return json.data;
  }

  async listJurisdictions(opts?: { state?: string; type?: string }): Promise<ApiResult<Jurisdiction[]>> {
    return this.request<Jurisdiction[]>('jurisdictions', {
      state: opts?.state,
      type: opts?.type,
    });
  }

  async getJurisdiction(id: string): Promise<ApiResult<Jurisdiction>> {
    return this.request<Jurisdiction>(`jurisdictions/${encodeURIComponent(id)}`);
  }

  async getToc(id: string, opts?: { depth?: number; path?: string }): Promise<ApiResult<{ title: string; children: TocNode[] }>> {
    const endpoint = opts?.path
      ? `jurisdictions/${encodeURIComponent(id)}/toc/${opts.path}`
      : `jurisdictions/${encodeURIComponent(id)}/toc`;
    return this.request<{ title: string; children: TocNode[] }>(endpoint, {
      depth: opts?.depth?.toString(),
    });
  }

  async getCodeText(id: string, path: string): Promise<ApiResult<CodeSection>> {
    return this.request<CodeSection>(`jurisdictions/${encodeURIComponent(id)}/code/${path}`);
  }

  async search(id: string, query: string, opts?: { limit?: number }): Promise<ApiResult<SearchResult[]>> {
    const result = await this.request<{ results: SearchResult[]; total: number }>(`jurisdictions/${encodeURIComponent(id)}/search`, {
      q: query,
      limit: opts?.limit?.toString(),
    });
    if (isCrawling(result)) return result;
    return result.results;
  }

  async lookup(opts: { city?: string; state?: string; slug?: string }): Promise<ApiResult<Jurisdiction | Jurisdiction[]>> {
    return this.request<Jurisdiction | Jurisdiction[]>('lookup', {
      city: opts.city,
      state: opts.state,
      slug: opts.slug,
    });
  }
}

export { isCrawling };
