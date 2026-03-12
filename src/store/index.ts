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
    const jurisdictions: Jurisdiction[] = JSON.parse(raw);

    const newJurisdictions = new Map<string, Jurisdiction>();
    const newTocTrees = new Map<string, TocTree>();

    for (const j of jurisdictions) {
      newJurisdictions.set(j.id, j);

      const tocPath = join(this.codesDir, j.id, '_toc.json');
      if (existsSync(tocPath)) {
        newTocTrees.set(j.id, JSON.parse(readFileSync(tocPath, 'utf-8')));
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
