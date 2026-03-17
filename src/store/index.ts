import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Jurisdiction, TocTree, TocNode } from '../types.js';
import { SearchIndex } from './search-index.js';
import type { SearchResult } from './search-index.js';

export type { SearchResult };

/**
 * CodeStore — reads jurisdiction metadata, TOC trees, and code files.
 * On initialization, loads all data into memory including a search index
 * so queries never hit disk. This supports high-concurrency scenarios
 * (100+ concurrent searches) without blocking on file I/O.
 */
export class CodeStore {
  private codesDir: string;
  private jurisdictions: Map<string, Jurisdiction> = new Map();
  private tocTrees: Map<string, TocTree> = new Map();
  private searchIndex: SearchIndex;

  constructor(codesDir?: string) {
    this.codesDir = codesDir || join(process.cwd(), 'codes');
    this.searchIndex = new SearchIndex(this.codesDir);
  }

  /** Load jurisdictions, TOC trees, and search index into memory.
   *  Builds into temp variables then swaps atomically so readers never see partial state. */
  initialize(): void {
    const registryPath = join(this.codesDir, 'jurisdictions.json');
    if (!existsSync(registryPath)) {
      console.warn(`[CodeStore] No jurisdictions.json found at ${registryPath}`);
      return;
    }

    const raw = readFileSync(registryPath, 'utf-8');
    let jurisdictions: Jurisdiction[];
    try {
      jurisdictions = JSON.parse(raw);
    } catch (err: any) {
      console.error(`[CodeStore] Failed to parse jurisdictions.json: ${err.message}`);
      console.error(`[CodeStore] File may be corrupt — skipping load. Fix or regenerate the file.`);
      return;
    }

    const newJurisdictions = new Map<string, Jurisdiction>();
    const newTocTrees = new Map<string, TocTree>();

    for (const j of jurisdictions) {
      const tocPath = join(this.codesDir, j.id, '_toc.json');
      if (existsSync(tocPath)) {
        try {
          const toc = JSON.parse(readFileSync(tocPath, 'utf-8')) as TocTree;
          if (!Array.isArray(toc.children) || toc.children.length === 0) {
            console.warn(`[CodeStore] Skipping ${j.id}: empty _toc.json`);
            continue;
          }
          newTocTrees.set(j.id, toc);
          newJurisdictions.set(j.id, j);
        } catch (err: any) {
          console.error(`[CodeStore] Skipping ${j.id}: corrupt _toc.json (${err.message})`);
        }
      }
    }

    // Atomic swap
    this.jurisdictions = newJurisdictions;
    this.tocTrees = newTocTrees;

    // Build new search index
    const newIndex = new SearchIndex(this.codesDir);
    newIndex.buildAll(this.tocTrees);
    this.searchIndex = newIndex;

    console.log(`[CodeStore] Loaded ${this.jurisdictions.size} jurisdictions`);
  }

  /**
   * Incrementally load or reload a single jurisdiction after its crawl completes.
   * Much faster than full initialize() — reads one _toc.json and rebuilds one
   * jurisdiction's search index instead of reloading everything.
   */
  loadOneJurisdiction(id: string): void {
    const registryPath = join(this.codesDir, 'jurisdictions.json');
    if (!existsSync(registryPath)) return;

    let jurisdictions: Jurisdiction[];
    try {
      jurisdictions = JSON.parse(readFileSync(registryPath, 'utf-8'));
    } catch {
      return;
    }

    const j = jurisdictions.find((x) => x.id === id);
    if (!j) return;

    const tocPath = join(this.codesDir, id, '_toc.json');
    if (!existsSync(tocPath)) return;

    try {
      const toc = JSON.parse(readFileSync(tocPath, 'utf-8')) as TocTree;
      if (!Array.isArray(toc.children) || toc.children.length === 0) {
        console.warn(`[CodeStore] Skipping ${id}: empty _toc.json`);
        return;
      }
      this.jurisdictions.set(id, j);
      this.tocTrees.set(id, toc);
      this.searchIndex.buildForJurisdiction(id, toc);
      console.log(`[CodeStore] Loaded ${id}`);
    } catch (err: any) {
      console.error(`[CodeStore] Failed to load ${id}: ${err.message}`);
    }
  }

  getJurisdiction(id: string): Jurisdiction | undefined {
    return this.jurisdictions.get(id);
  }

  listJurisdictions(filters?: {
    type?: string;
    state?: string;
    publisher?: string;
  }): Jurisdiction[] {
    let results = Array.from(this.jurisdictions.values());

    if (filters?.type) {
      results = results.filter((j) => j.type === filters.type);
    }
    if (filters?.state) {
      results = results.filter(
        (j) => j.state?.toLowerCase() === filters.state!.toLowerCase()
      );
    }
    if (filters?.publisher) {
      results = results.filter(
        (j) => j.publisher.name === filters.publisher
      );
    }

    return results;
  }

  getToc(jurisdictionId: string): TocTree | undefined {
    return this.tocTrees.get(jurisdictionId);
  }

  hasUsableToc(jurisdictionId: string): boolean {
    const toc = this.tocTrees.get(jurisdictionId);
    return !!toc && Array.isArray(toc.children) && toc.children.length > 0;
  }

  /** Find a TOC node by path (for metadata lookups) */
  getTocNode(jurisdictionId: string, codePath: string): TocNode | undefined {
    const toc = this.tocTrees.get(jurisdictionId);
    if (!toc) return undefined;
    return this.findNodeByPath(toc.children, codePath);
  }

  private findNodeByPath(nodes: TocNode[], targetPath: string): TocNode | undefined {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (targetPath.startsWith(node.path + '/') && node.children) {
        const found = this.findNodeByPath(node.children, targetPath);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Read a USLM XML file from disk by jurisdiction and path */
  getCodeXml(jurisdictionId: string, codePath: string): string | null {
    const filePath = join(this.codesDir, jurisdictionId, `${codePath}.xml`);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, 'utf-8');
  }

  /** Read the original HTML file from disk */
  getCodeHtml(jurisdictionId: string, codePath: string): string | null {
    const filePath = join(this.codesDir, jurisdictionId, `${codePath}.html`);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, 'utf-8');
  }

  /** Get plain text content — uses in-memory index first, falls back to disk */
  getCodeText(jurisdictionId: string, codePath: string): string | null {
    // Try index first (no disk I/O)
    const indexed = this.searchIndex.getText(jurisdictionId, codePath);
    if (indexed !== null) return indexed;

    // Fall back to disk for non-indexed content
    const html = this.getCodeHtml(jurisdictionId, codePath);
    if (!html) return null;
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Search for keywords within a jurisdiction. Uses in-memory index — no disk I/O. */
  search(jurisdictionId: string, query: string, limit = 20): SearchResult[] {
    return this.searchIndex.search(jurisdictionId, query, limit);
  }

  /** Check if a jurisdiction has search index */
  hasSearchIndex(jurisdictionId: string): boolean {
    return this.searchIndex.hasIndex(jurisdictionId);
  }
}

export const store = new CodeStore();
