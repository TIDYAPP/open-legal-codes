import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';

const API_BASE = 'https://www.ecfr.gov/api';

/**
 * eCFR (Electronic Code of Federal Regulations) Crawler Adapter
 *
 * Uses the free eCFR API (no key required):
 *   GET /versioner/v1/titles                           — list all 50 CFR titles
 *   GET /versioner/v1/structure/{date}/title-{N}       — TOC structure for a title
 *   GET /renderer/v1/content/enhanced/{date}/title-{N} — full XML/HTML content
 *   GET /search/v1/results                             — full-text search
 *
 * The sourceId for this adapter is the title number (e.g., "24" for Housing).
 *
 * Property-relevant titles:
 *   Title 12 — Banks and Banking (mortgage regs)
 *   Title 24 — Housing and Urban Development
 *   Title 26 — Internal Revenue (property tax)
 *   Title 29 — Labor (fair housing enforcement)
 */
export class EcfrCrawler implements CrawlerAdapter {
  readonly publisherName = 'ecfr' as const;
  private http: HttpClient;

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 1000 });
  }

  async *listJurisdictions(_state?: string): AsyncIterable<Jurisdiction> {
    const today = formatDate();
    const data = await this.http.getJson<{ titles: EcfrTitle[] }>(
      `${API_BASE}/versioner/v1/titles`,
    );

    for (const title of data.titles) {
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
    const today = formatDate();

    console.log(`[ecfr] Fetching structure for CFR Title ${titleNum}`);

    const data = await this.http.getJson<EcfrStructure>(
      `${API_BASE}/versioner/v1/structure/${today}/title-${titleNum}`,
    );

    if (!data.children) return [];
    return data.children.map(child => this.transformStructureNode(child));
  }

  private transformStructureNode(node: EcfrStructureNode): RawTocNode {
    const title = node.label
      ? `${node.label_level || ''} ${node.label} - ${node.label_description || ''}`.trim()
      : `${node.type} ${node.identifier || ''}`.trim();

    return {
      id: node.identifier || node.label || title,
      title: title.replace(/\s+/g, ' ').trim(),
      level: mapEcfrLevel(node.type),
      hasContent: node.type === 'section',
      children: (node.children || []).map(c => this.transformStructureNode(c)),
    };
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const titleNum = sourceId;
    const today = formatDate();

    // sectionId is the section number like "200.1"
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
          'cfr_title': sourceId,
          per_page: String(limit),
          page: '1',
        },
      );

      if (!data.results) return [];

      return data.results.map(r => ({
        title: r.headings?.section || r.headings?.part || '',
        snippet: r.full_text_excerpt || r.snippet || '',
        nodeId: r.section_number || r.hierarchy?.section || '',
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
  children?: EcfrStructureNode[];
}

interface EcfrSearchResponse {
  results: Array<{
    headings?: { section?: string; part?: string };
    full_text_excerpt?: string;
    snippet?: string;
    section_number?: string;
    hierarchy?: { section?: string };
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
