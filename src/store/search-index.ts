import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TocTree, TocNode } from '../types.js';

export interface IndexedSection {
  path: string;
  num: string;
  heading: string;
  /** Full plain text, original casing */
  text: string;
  /** Lowercased text for case-insensitive search */
  textLower: string;
}

export interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
}

/**
 * SearchIndex — in-memory full-text index for keyword search.
 *
 * On startup, loads all cached HTML content into memory as plain text.
 * Search is a simple string scan over the in-memory text — no disk I/O
 * at query time, so it handles many concurrent searches without blocking.
 *
 * Memory: ~2.5MB per jurisdiction (Mountain View = 312 sections).
 * 100 jurisdictions ≈ 250MB — well within typical server RAM.
 */
export class SearchIndex {
  private sections: Map<string, IndexedSection[]> = new Map();

  constructor(private codesDir: string) {}

  /** Build index for all jurisdictions that have TOC + cached content */
  buildAll(tocTrees: Map<string, TocTree>): void {
    let totalSections = 0;
    for (const [jurisdictionId, toc] of tocTrees) {
      const count = this.buildForJurisdiction(jurisdictionId, toc);
      totalSections += count;
    }
    console.log(`[SearchIndex] Indexed ${totalSections} sections across ${this.sections.size} jurisdictions`);
  }

  /** Build or rebuild index for a single jurisdiction */
  buildForJurisdiction(jurisdictionId: string, toc: TocTree): number {
    const entries: IndexedSection[] = [];

    function walk(nodes: TocNode[]) {
      for (const node of nodes) {
        if (node.hasContent) {
          const htmlPath = join(process.cwd(), 'codes', jurisdictionId, `${node.path}.html`);
          if (existsSync(htmlPath)) {
            const html = readFileSync(htmlPath, 'utf-8');
            const text = stripHtml(html);
            if (text) {
              entries.push({
                path: node.path,
                num: node.num,
                heading: node.heading,
                text,
                textLower: text.toLowerCase(),
              });
            }
          }
        }
        if (node.children) walk(node.children);
      }
    }

    walk(toc.children);
    this.sections.set(jurisdictionId, entries);
    return entries.length;
  }

  /** Search for keyword matches within a jurisdiction. No disk I/O. */
  search(jurisdictionId: string, query: string, limit = 20): SearchResult[] {
    const entries = this.sections.get(jurisdictionId);
    if (!entries) return [];

    const queryLower = query.toLowerCase();
    const queryLen = query.length;
    const results: SearchResult[] = [];

    for (const entry of entries) {
      if (results.length >= limit) break;

      const idx = entry.textLower.indexOf(queryLower);
      if (idx === -1) continue;

      const start = Math.max(0, idx - 80);
      const end = Math.min(entry.text.length, idx + queryLen + 80);
      const snippet =
        (start > 0 ? '...' : '') +
        entry.text.slice(start, end) +
        (end < entry.text.length ? '...' : '');

      results.push({
        path: entry.path,
        num: entry.num,
        heading: entry.heading,
        snippet,
      });
    }

    return results;
  }

  /** Check if a jurisdiction has been indexed */
  hasIndex(jurisdictionId: string): boolean {
    return this.sections.has(jurisdictionId);
  }

  /** Get the number of indexed sections for a jurisdiction */
  sectionCount(jurisdictionId: string): number {
    return this.sections.get(jurisdictionId)?.length ?? 0;
  }

  /** Get the plain text for a specific section (from index, no disk I/O) */
  getText(jurisdictionId: string, path: string): string | null {
    const entries = this.sections.get(jurisdictionId);
    if (!entries) return null;
    const entry = entries.find(e => e.path === path);
    return entry?.text ?? null;
  }
}

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
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
