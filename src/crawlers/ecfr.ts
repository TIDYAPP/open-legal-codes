import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';

const API_BASE = 'https://www.ecfr.gov/api';

/**
 * eCFR (Electronic Code of Federal Regulations) Crawler Adapter
 *
 * Uses the free eCFR API (no key required):
 *   GET /versioner/v1/titles                                — list all 50 CFR titles
 *   GET /versioner/v1/structure/{date}/title-{N}.json       — TOC structure (requires .json!)
 *   GET /renderer/v1/content/enhanced/{date}/title-{N}      — HTML content (follows redirects)
 *   GET /search/v1/results?query=X&hierarchy[title]=N       — full-text search
 *
 * The sourceId for this adapter is the title number (e.g., "24" for Housing).
 *
 * Property-relevant titles:
 *   Title 12 — Banks and Banking (mortgage regs)
 *   Title 24 — Housing and Urban Development
 *   Title 26 — Internal Revenue (property tax)
 *   Title 29 — Labor (fair housing enforcement)
 *
 * Structure hierarchy varies by title:
 *   Title 24: title → subtitle → part → [subpart] → section
 *   Title 26: title → chapter → subchapter → part → [subpart|subject_group] → section
 *
 * Content HTML includes data-hierarchy-metadata attributes with citation info.
 * Permalinks: https://www.ecfr.gov/current/title-{N}/section-{id}
 */
export class EcfrCrawler implements CrawlerAdapter {
  readonly publisherName = 'ecfr' as const;
  private http: HttpClient;
  private cachedLatestDate: string | null = null;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1000 });
  }

  /**
   * Fetch the latest available date from the eCFR API.
   * The API only serves data up to its latest version date, which may lag
   * behind today's date. Using today's date causes 404s when it's ahead.
   * Falls back to today's date if the titles endpoint fails.
   */
  private async getLatestDate(): Promise<string> {
    if (this.cachedLatestDate) return this.cachedLatestDate;

    try {
      const data = await this.http.getJson<{ meta: { date: string } }>(
        `${API_BASE}/versioner/v1/titles`,
      );
      if (data.meta?.date) {
        this.cachedLatestDate = data.meta.date;
        return this.cachedLatestDate;
      }
    } catch (err) {
      console.warn('[ecfr] Failed to fetch latest date from API, falling back to today:', err);
    }

    this.cachedLatestDate = formatDate();
    return this.cachedLatestDate;
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    const data = await this.http.getJson<{ titles: EcfrTitle[] }>(
      `${API_BASE}/versioner/v1/titles`,
    );

    for (const title of data.titles) {
      if (title.reserved) continue;
      yield {
        id: `us-cfr-title-${title.number}`,
        name: `CFR Title ${title.number} — ${title.name}`,
        type: 'federal',
        state: null,
        parentId: 'us',
        fips: null,
        publisher: {
          name: 'ecfr',
          sourceId: String(title.number),
          url: `https://www.ecfr.gov/current/title-${title.number}`,
        },
        lastCrawled: '',
        lastUpdated: title.latest_amended_on || '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const titleNum = sourceId;
    const today = await this.getLatestDate();

    console.log(`[ecfr] Fetching structure for CFR Title ${titleNum}`);

    // IMPORTANT: The structure endpoint requires .json extension or returns 406
    const data = await this.http.getJson<EcfrStructure>(
      `${API_BASE}/versioner/v1/structure/${today}/title-${titleNum}.json`,
    );

    if (!data.children) return [];
    return data.children.map(child => this.transformStructureNode(child));
  }

  private transformStructureNode(node: EcfrStructureNode): RawTocNode {
    // Build a readable title from the node's label fields
    // label_level: "Part 1", label_description: "General Provisions"
    // label: "Title 24—Housing and Urban Development" (full combined label)
    let title: string;
    if (node.label_level && node.label_description) {
      title = `${node.label_level} - ${node.label_description}`;
    } else if (node.label) {
      title = node.label;
    } else {
      title = `${node.type} ${node.identifier || ''}`.trim();
    }

    // Skip reserved (empty) nodes
    if (node.reserved) {
      return {
        id: node.identifier || title,
        title: `[Reserved] ${title}`,
        level: mapEcfrLevel(node.type),
        hasContent: false,
        children: [],
      };
    }

    return {
      id: node.identifier || node.label || title,
      title: title.replace(/\s+/g, ' ').trim(),
      level: mapEcfrLevel(node.type),
      hasContent: node.type === 'section',
      children: (node.children || [])
        .filter(c => !c.reserved)
        .map(c => this.transformStructureNode(c)),
    };
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const titleNum = sourceId;
    const today = await this.getLatestDate();

    // The content endpoint accepts hierarchy params and follows redirects
    // to add any missing parent hierarchy levels automatically
    const url = `${API_BASE}/renderer/v1/content/enhanced/${today}/title-${titleNum}`;
    const params: Record<string, string> = {
      'section': sectionId,
    };

    console.log(`[ecfr] Fetching section ${sectionId} of Title ${titleNum}`);

    const html = await this.http.getHtml(url, params);

    return {
      html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: `https://www.ecfr.gov/current/title-${titleNum}/section-${sectionId}`,
    };
  }

  /**
   * Search the eCFR for keywords within a specific title.
   */
  async searchRemote(
    sourceId: string,
    query: string,
    limit = 20,
  ): Promise<{ title: string; snippet: string; nodeId: string }[]> {
    try {
      const data = await this.http.getJson<EcfrSearchResponse>(
        `${API_BASE}/search/v1/results`,
        {
          query,
          'hierarchy[title]': sourceId,
          per_page: String(limit),
          page: '1',
        },
      );

      if (!data.results) return [];

      return data.results
        .filter(r => !r.removed && r.ends_on === null) // Only current versions
        .map(r => ({
          title: r.headings?.section || r.headings?.part || '',
          snippet: r.full_text_excerpt || '',
          nodeId: r.hierarchy?.section || '',
        }));
    } catch {
      return [];
    }
  }
}

// --- eCFR API response types ---

interface EcfrTitle {
  number: number;
  name: string;
  latest_amended_on: string;
  latest_issue_date: string;
  up_to_date_as_of: string;
  reserved: boolean;
}

interface EcfrStructure {
  type: string;
  identifier: string;
  label: string;
  children?: EcfrStructureNode[];
}

interface EcfrStructureNode {
  type: string;
  identifier?: string;
  label?: string;
  label_level?: string;
  label_description?: string;
  reserved?: boolean;
  descendant_range?: string;
  children?: EcfrStructureNode[];
}

interface EcfrSearchResponse {
  results: Array<{
    headings?: { section?: string; part?: string };
    hierarchy?: { title?: string; section?: string; part?: string };
    full_text_excerpt?: string;
    starts_on?: string;
    ends_on?: string | null;
    removed?: boolean;
    score?: number;
  }>;
  total_count?: number;
}

// --- Helpers ---

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mapEcfrLevel(type: string): string {
  const map: Record<string, string> = {
    'title': 'title',
    'subtitle': 'subtitle',
    'chapter': 'chapter',
    'subchapter': 'subchapter',
    'part': 'part',
    'subpart': 'subpart',
    'subject_group': 'division',
    'section': 'section',
    'appendix': 'part',
  };
  return map[type] || 'section';
}
