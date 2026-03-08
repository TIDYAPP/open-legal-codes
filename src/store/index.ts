import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Jurisdiction, TocTree, TocNode } from '../types.js';

/**
 * CodeStore — reads jurisdiction metadata, TOC trees, and USLM XML files
 * from the filesystem. Loads indexes into memory on initialization.
 */
export class CodeStore {
  private codesDir: string;
  private jurisdictions: Map<string, Jurisdiction> = new Map();
  private tocTrees: Map<string, TocTree> = new Map();

  constructor(codesDir?: string) {
    this.codesDir = codesDir || join(process.cwd(), 'codes');
  }

  /** Load jurisdictions.json and all _toc.json files into memory */
  initialize(): void {
    const registryPath = join(this.codesDir, 'jurisdictions.json');
    if (!existsSync(registryPath)) {
      console.warn(`[CodeStore] No jurisdictions.json found at ${registryPath}`);
      return;
    }

    const raw = readFileSync(registryPath, 'utf-8');
    const jurisdictions: Jurisdiction[] = JSON.parse(raw);

    for (const j of jurisdictions) {
      this.jurisdictions.set(j.id, j);

      // Load TOC tree if available
      const tocPath = join(this.codesDir, j.id, '_toc.json');
      if (existsSync(tocPath)) {
        const tocRaw = readFileSync(tocPath, 'utf-8');
        this.tocTrees.set(j.id, JSON.parse(tocRaw));
      }
    }

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

  /** Get plain text content (strips HTML tags) */
  getCodeText(jurisdictionId: string, codePath: string): string | null {
    const html = this.getCodeHtml(jurisdictionId, codePath);
    if (!html) return null;
    // Strip HTML tags and decode basic entities
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
}

export const store = new CodeStore();
