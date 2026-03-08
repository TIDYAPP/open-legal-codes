import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction } from '../types.js';
import { HttpClient } from './http-client.js';

const API_BASE = 'https://api.municode.com';

const STATE_ABBRS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

// --- Municode API response shapes ---

interface MunicodeClient {
  ClientID: number;
  ClientName: string;
  State: { StateID: number; StateName: string; StateAbbreviation: string };
  City: string;
  Website: string;
}

interface MunicodeProduct {
  ProductID: number;
  ProductName: string;
  ContentType: { Id: string; Name: string };
  Client: MunicodeClient;
}

interface MunicodeJob {
  Id: number;
  Name: string;
  ProductId: number;
}

interface MunicodeTocNode {
  Id: string;
  Heading: string;
  NodeDepth: number;
  HasChildren: boolean;
  ParentId: string;
  DocOrderId: number;
  Children: MunicodeTocNode[];
}

interface MunicodeContentDoc {
  Id: string;
  Title: string;
  TitleHtml: string;
  Content: string;
  NodeDepth: number;
}

interface MunicodeContentResponse {
  Docs: MunicodeContentDoc[];
}

/**
 * Municode Crawler Adapter
 *
 * Uses Municode's public API at api.municode.com:
 *   GET /Clients/stateAbbr?stateAbbr=XX
 *   GET /Products/clientId/{clientId}
 *   GET /Jobs/latest/{productId}
 *   GET /codesToc/children?productId=X&jobId=X&nodeId=X
 *   GET /CodesContent?productId=X&jobId=X&nodeId=X
 */
export class MunicodeCrawler implements CrawlerAdapter {
  readonly publisherName = 'municode' as const;
  private http: HttpClient;
  private resolveCache = new Map<string, { clientId: number; productId: number; jobId: number }>();

  constructor(http?: HttpClient) {
    this.http = http ?? new HttpClient({ minDelayMs: 500 });
  }

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const states = state ? [state.toUpperCase()] : STATE_ABBRS;

    for (const abbr of states) {
      let clients: MunicodeClient[];
      try {
        clients = await this.http.getJson<MunicodeClient[]>(
          `${API_BASE}/Clients/stateAbbr`,
          { stateAbbr: abbr },
        );
      } catch (err) {
        console.warn(`[municode] Failed to list clients for ${abbr}: ${err}`);
        continue;
      }

      for (const client of clients) {
        const slug = slugify(client.ClientName);
        yield {
          id: `${abbr.toLowerCase()}-${slug}`,
          name: `${client.ClientName}, ${abbr}`,
          type: 'city',
          state: abbr,
          parentId: abbr.toLowerCase(),
          fips: null,
          publisher: {
            name: 'municode',
            sourceId: String(client.ClientID),
            url: `https://library.municode.com/${abbr.toLowerCase()}/${slug}/codes/code_of_ordinances`,
          },
          lastCrawled: '',
          lastUpdated: '',
        };
      }
    }
  }

  /** Resolve a numeric ClientID to productId and jobId. */
  async resolve(sourceId: string): Promise<{ clientId: number; productId: number; jobId: number }> {
    const cached = this.resolveCache.get(sourceId);
    if (cached) return cached;

    const clientId = parseInt(sourceId, 10);
    if (isNaN(clientId)) {
      throw new Error(`sourceId must be a numeric ClientID, got "${sourceId}"`);
    }

    const products = await this.http.getJson<MunicodeProduct[]>(
      `${API_BASE}/Products/clientId/${clientId}`,
    );
    const codesProduct = products.find(p => p.ContentType.Id === 'CODES');
    if (!codesProduct) {
      throw new Error(`No Codes product found for client ${clientId}`);
    }

    const job = await this.http.getJson<MunicodeJob>(
      `${API_BASE}/Jobs/latest/${codesProduct.ProductID}`,
    );

    const result = { clientId, productId: codesProduct.ProductID, jobId: job.Id };
    this.resolveCache.set(sourceId, result);
    return result;
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const { productId, jobId } = await this.resolve(sourceId);
    const params = { productId: String(productId), jobId: String(jobId) };

    console.log(`[municode] Fetching TOC for product ${productId}, job ${jobId}`);

    const rootNodes = await this.http.getJson<MunicodeTocNode[]>(
      `${API_BASE}/codesToc/children`,
      { ...params, nodeId: String(productId) },
    );

    const result: RawTocNode[] = [];
    for (const node of rootNodes) {
      result.push(await this.expandNode(node, params, 0));
    }

    return result;
  }

  private async expandNode(
    node: MunicodeTocNode,
    params: { productId: string; jobId: string },
    depth: number,
  ): Promise<RawTocNode> {
    const raw: RawTocNode = {
      id: node.Id,
      title: node.Heading,
      level: guessLevel(node),
      hasContent: !node.HasChildren,
      children: [],
    };

    if (node.HasChildren && depth < 10) {
      console.log(`[municode]   ${'  '.repeat(depth)}${node.Heading}`);
      const children = await this.http.getJson<MunicodeTocNode[]>(
        `${API_BASE}/codesToc/children`,
        { ...params, nodeId: node.Id },
      );

      for (const child of children) {
        raw.children.push(await this.expandNode(child, params, depth + 1));
      }
    }

    return raw;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const { productId, jobId } = await this.resolve(sourceId);

    const data = await this.http.getJson<MunicodeContentResponse>(
      `${API_BASE}/CodesContent`,
      {
        productId: String(productId),
        jobId: String(jobId),
        nodeId: sectionId,
      },
    );

    // Find the doc matching the requested node
    const targetDoc = data.Docs.find(d => d.Id === sectionId);
    const html = targetDoc
      ? `${targetDoc.TitleHtml}\n${targetDoc.Content}`
      : data.Docs.map(d => `${d.TitleHtml}\n${d.Content}`).join('\n');

    return {
      html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: `${API_BASE}/CodesContent?productId=${productId}&jobId=${jobId}&nodeId=${sectionId}`,
    };
  }
}

function guessLevel(node: MunicodeTocNode): string {
  const h = node.Heading.toLowerCase();
  if (h.startsWith('part ')) return 'part';
  if (h.startsWith('title ')) return 'title';
  if (h.startsWith('article ')) return 'article';
  if (h.startsWith('division ')) return 'division';
  if (h.startsWith('chapter ')) return 'chapter';
  if (h.startsWith('subchapter ')) return 'subchapter';
  if (h.startsWith('section ') || /^\d+[\.\-]/.test(h)) return 'section';
  if (node.NodeDepth <= 1) return 'part';
  if (node.NodeDepth === 2) return 'chapter';
  return 'section';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
