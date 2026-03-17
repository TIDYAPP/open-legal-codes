import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';

const API_BASE = 'https://legislation.nysenate.gov/api/3';

/**
 * New York Open Legislation Crawler Adapter
 *
 * Uses the NY Senate Open Legislation API (free, requires API key):
 *   GET /api/3/laws                          — list all law codes
 *   GET /api/3/laws/{lawId}                  — TOC tree for a law
 *   GET /api/3/laws/{lawId}/{locationId}/     — section text
 *
 * API key: set NY_OPENLEG_API_KEY env var, or register free at legislation.nysenate.gov
 *
 * Law IDs are 3-letter codes (e.g., GBS = General Business, RPP = Real Property).
 * Section text is plain text (not HTML).
 */
export class NyOpenlegCrawler implements CrawlerAdapter {
  readonly publisherName = 'ny-openleg' as const;
  private http: HttpClient;
  private apiKey: string;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 500 });
    this.apiKey = process.env.NY_OPENLEG_API_KEY || '';
  }

  private params(extra?: Record<string, string>): Record<string, string> {
    const p: Record<string, string> = {};
    if (this.apiKey) p.key = this.apiKey;
    if (extra) Object.assign(p, extra);
    return p;
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    if (_state && _state.toUpperCase() !== 'NY') return;

    const data = await this.http.getJson<NyLawsResponse>(
      `${API_BASE}/laws`,
      this.params({ limit: '1000' }),
    );

    const items = data.result?.items || [];

    for (const law of items) {
      const code = law.lawId;
      const slug = code.toLowerCase();
      yield {
        id: `ny-${slug}`,
        name: `New York ${law.name}`,
        type: 'state',
        state: 'NY',
        parentId: 'ny',
        fips: '36',
        publisher: {
          name: 'ny-openleg',
          sourceId: code,
          url: `https://www.nysenate.gov/legislation/laws/${code}`,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    console.log(`[ny-openleg] Fetching TOC for ${sourceId}`);

    const data = await this.http.getJson<NyLawTreeResponse>(
      `${API_BASE}/laws/${sourceId}`,
      this.params(),
    );

    const root = data.result;
    if (!root?.documents?.documents?.items) {
      console.warn(`[ny-openleg] No documents found for ${sourceId}`);
      return [];
    }

    return root.documents.documents.items.map(node => this.transformNode(node));
  }

  private transformNode(node: NyLawNode): RawTocNode {
    const title = node.title || '';
    const docType = (node.docType || '').toLowerCase();
    const isSection = docType === 'section';

    return {
      id: node.locationId || node.docLevelId || '',
      title: title,
      level: mapDocType(docType),
      hasContent: isSection,
      children: (node.documents?.items || []).map(c => this.transformNode(c)),
    };
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    // Trailing slash is required because locationIds can contain periods
    const url = `${API_BASE}/laws/${sourceId}/${sectionId}/`;
    console.log(`[ny-openleg] Fetching section ${sourceId}/${sectionId}`);

    const data = await this.http.getJson<NySectionResponse>(
      url,
      this.params(),
    );

    const result = data.result;
    const text = result?.text || '';

    // Wrap plain text in HTML for consistency with other adapters
    const heading = result?.title || sectionId;
    const html = `<h2>${escapeHtml(heading)}</h2>\n<pre>${escapeHtml(text)}</pre>`;

    return {
      html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: `https://www.nysenate.gov/legislation/laws/${sourceId}/${sectionId}`,
    };
  }
}

// --- NY API response shapes ---

interface NyLawsResponse {
  result: {
    items: Array<{
      lawId: string;
      name: string;
      lawType: string;
      chapter: string;
    }>;
  };
}

interface NyLawNode {
  lawId?: string;
  locationId?: string;
  title?: string;
  docType?: string;
  docLevelId?: string;
  activeDate?: string;
  sequenceNo?: number;
  fromSection?: string;
  toSection?: string;
  text?: string | null;
  documents?: {
    items: NyLawNode[];
  };
}

interface NyLawTreeResponse {
  result: {
    info: { lawId: string; name: string; lawType: string };
    documents: {
      documents: {
        items: NyLawNode[];
      };
    };
  };
}

interface NySectionResponse {
  result: {
    lawId: string;
    locationId: string;
    title: string;
    docType: string;
    text: string;
    activeDate: string;
  };
}

// --- Helpers ---

function mapDocType(docType: string): string {
  const map: Record<string, string> = {
    chapter: 'chapter',
    article: 'article',
    title: 'title',
    part: 'part',
    subpart: 'subpart',
    section: 'section',
    subtitle: 'subtitle',
  };
  return map[docType] || 'part';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
