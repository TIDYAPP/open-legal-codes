import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CrawlerAdapter, RawTocNode, RawContent } from './types.js';
import type { Jurisdiction, JurisdictionType } from '../types.js';
import { HttpClient } from './http-client.js';
import { parsePdf, type PdfSection } from '../converter/pdf-to-html.js';

interface ManualDocument {
  id: string;
  title: string;
  url: string;
  format: 'pdf' | 'html';
}

interface ManualSource {
  id: string;
  name: string;
  type: JurisdictionType;
  state: string | null;
  parentId: string | null;
  fips?: string | null;
  lat?: number | null;
  lng?: number | null;
  population?: number | null;
  sourceUrl: string;
  documents: ManualDocument[];
}

/**
 * Manual/config-driven crawler for jurisdictions without a standard publisher API.
 * Reads source definitions from data/manual-sources.json.
 * Supports PDF and HTML documents.
 */
export class ManualCrawler implements CrawlerAdapter {
  readonly publisherName = 'manual' as const;
  private http: HttpClient;
  private configPath: string;
  private pdfCache = new Map<string, PdfSection[]>();

  constructor(configPath?: string) {
    this.http = new HttpClient({ minDelayMs: 200 });
    this.configPath = configPath ?? join(process.cwd(), 'data', 'manual-sources.json');
  }

  private async loadConfig(): Promise<ManualSource[]> {
    const raw = await readFile(this.configPath, 'utf-8');
    return JSON.parse(raw) as ManualSource[];
  }

  private async findSource(sourceId: string): Promise<ManualSource> {
    const sources = await this.loadConfig();
    const source = sources.find(s => s.id === sourceId);
    if (!source) {
      throw new Error(`Manual source not found: "${sourceId}"`);
    }
    return source;
  }

  async *listJurisdictions(state?: string): AsyncIterable<Jurisdiction> {
    const sources = await this.loadConfig();

    for (const source of sources) {
      if (state && source.state?.toUpperCase() !== state.toUpperCase()) continue;

      yield {
        id: source.id,
        name: source.name,
        type: source.type,
        state: source.state,
        parentId: source.parentId,
        fips: source.fips ?? null,
        publisher: {
          name: 'manual' as const,
          sourceId: source.id,
          url: source.sourceUrl,
        },
        lastCrawled: '',
        lastUpdated: '',
      };
    }
  }

  async fetchToc(sourceId: string): Promise<RawTocNode[]> {
    const source = await this.findSource(sourceId);
    const nodes: RawTocNode[] = [];

    for (const doc of source.documents) {
      if (doc.format === 'pdf') {
        const sections = await this.fetchAndParsePdf(doc);
        this.pdfCache.set(`${sourceId}:${doc.id}`, sections);

        if (sections.length === 1) {
          // Single section — the document is one content node
          nodes.push({
            id: `${doc.id}:${sections[0].id}`,
            title: doc.title,
            level: 'part',
            hasContent: true,
            children: [],
          });
        } else {
          // Multiple sections — document is a container with children
          const children: RawTocNode[] = sections.map(section => ({
            id: `${doc.id}:${section.id}`,
            title: section.title,
            level: 'section',
            hasContent: true,
            children: [],
          }));

          nodes.push({
            id: doc.id,
            title: doc.title,
            level: 'part',
            hasContent: false,
            children,
          });
        }
      } else {
        // HTML document — single content node
        nodes.push({
          id: doc.id,
          title: doc.title,
          level: 'part',
          hasContent: true,
          children: [],
        });
      }
    }

    return nodes;
  }

  async fetchSection(sourceId: string, sectionId: string): Promise<RawContent> {
    const source = await this.findSource(sourceId);

    // sectionId format: "docId:sectionSlug"
    const colonIdx = sectionId.indexOf(':');
    const docId = colonIdx >= 0 ? sectionId.substring(0, colonIdx) : sectionId;
    const sectionSlug = colonIdx >= 0 ? sectionId.substring(colonIdx + 1) : null;

    const doc = source.documents.find(d => d.id === docId);
    if (!doc) {
      throw new Error(`Document not found: "${docId}" in source "${sourceId}"`);
    }

    if (doc.format === 'pdf') {
      // Check cache first, otherwise re-parse
      const cacheKey = `${sourceId}:${doc.id}`;
      let sections = this.pdfCache.get(cacheKey);
      if (!sections) {
        sections = await this.fetchAndParsePdf(doc);
        this.pdfCache.set(cacheKey, sections);
      }

      const section = sectionSlug
        ? sections.find(s => s.id === sectionSlug)
        : sections[0];

      if (!section) {
        throw new Error(`Section not found: "${sectionId}" in document "${docId}"`);
      }

      return {
        html: section.html,
        fetchedAt: new Date().toISOString(),
        sourceUrl: doc.url,
      };
    }

    // HTML document
    const html = doc.url.startsWith('file://')
      ? await readFile(doc.url.replace('file://', ''), 'utf-8')
      : await this.http.getHtml(doc.url);

    return {
      html,
      fetchedAt: new Date().toISOString(),
      sourceUrl: doc.url,
    };
  }

  private async fetchAndParsePdf(doc: ManualDocument): Promise<PdfSection[]> {
    console.log(`[manual] Downloading PDF: ${doc.url}`);
    const buffer = await this.http.getBuffer(doc.url);
    console.log(`[manual] Parsing PDF (${(buffer.length / 1024).toFixed(0)} KB)...`);
    const result = await parsePdf(buffer);
    console.log(`[manual] Found ${result.sections.length} sections in "${result.title}"`);
    return result.sections;
  }
}
