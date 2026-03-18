import type Database from 'better-sqlite3';
import type { Jurisdiction, TocTree, TocNode } from '../types.js';
import { getDb } from './db.js';
export interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
  url: string;
}

/**
 * CodeStore — reads jurisdiction metadata, TOC trees, and code content from SQLite.
 *
 * Replaces the previous filesystem + in-memory Map implementation.
 * All reads go directly to SQLite (WAL mode enables concurrent reads).
 * Search uses FTS5 full-text search.
 */
export class CodeStore {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDb();
  }

  /** No-op — SQLite is always ready. Kept for backward compatibility. */
  initialize(): void {}

  /** No-op — SQLite is always current. Kept for backward compatibility. */
  loadOneJurisdiction(_id: string): void {}

  getJurisdiction(id: string): Jurisdiction | undefined {
    const row = this.db.prepare('SELECT * FROM jurisdictions WHERE id = ?').get(id) as any;
    return row ? rowToJurisdiction(row) : undefined;
  }

  listJurisdictions(filters?: {
    type?: string;
    state?: string;
    publisher?: string;
  }): Jurisdiction[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters?.state) {
      conditions.push('LOWER(state) = LOWER(?)');
      params.push(filters.state);
    }
    if (filters?.publisher) {
      conditions.push('publisher_name = ?');
      params.push(filters.publisher);
    }

    // Only return jurisdictions that have TOC data (i.e., have been crawled)
    conditions.push('EXISTS (SELECT 1 FROM toc_nodes WHERE jurisdiction_id = jurisdictions.id)');

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM jurisdictions ${where}`).all(...params) as any[];
    return rows.map(rowToJurisdiction);
  }

  getToc(jurisdictionId: string): TocTree | undefined {
    const rows = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? ORDER BY sort_order'
    ).all(jurisdictionId) as TocNodeRow[];

    if (rows.length === 0) return undefined;

    const jurisdiction = this.getJurisdiction(jurisdictionId);
    const tree = buildTocTree(rows, jurisdiction?.name || jurisdictionId);
    tree.jurisdiction = jurisdictionId;
    return tree;
  }

  hasUsableToc(jurisdictionId: string): boolean {
    const row = this.db.prepare(
      'SELECT EXISTS(SELECT 1 FROM toc_nodes WHERE jurisdiction_id = ?) as has_toc'
    ).get(jurisdictionId) as { has_toc: number };
    return row.has_toc === 1;
  }

  getTocNode(jurisdictionId: string, codePath: string): TocNode | undefined {
    const row = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? AND path = ?'
    ).get(jurisdictionId, codePath) as TocNodeRow | undefined;

    if (!row) return undefined;

    // Also fetch children
    const children = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? AND parent_path = ? ORDER BY sort_order'
    ).all(jurisdictionId, codePath) as TocNodeRow[];

    return rowToTocNode(row, children);
  }

  getCodeText(jurisdictionId: string, codePath: string): string | null {
    const row = this.db.prepare(
      'SELECT text FROM sections WHERE jurisdiction_id = ? AND path = ?'
    ).get(jurisdictionId, codePath) as { text: string | null } | undefined;
    return row?.text ?? null;
  }

  getCodeHtml(jurisdictionId: string, codePath: string): string | null {
    const row = this.db.prepare(
      'SELECT html FROM sections WHERE jurisdiction_id = ? AND path = ?'
    ).get(jurisdictionId, codePath) as { html: string | null } | undefined;
    return row?.html ?? null;
  }

  getCodeXml(jurisdictionId: string, codePath: string): string | null {
    const row = this.db.prepare(
      'SELECT xml FROM sections WHERE jurisdiction_id = ? AND path = ?'
    ).get(jurisdictionId, codePath) as { xml: string | null } | undefined;
    return row?.xml ?? null;
  }

  /**
   * Full-text search using FTS5.
   *
   * FTS5 uses tokenized word matching (better than the old substring search).
   * The snippet() function provides highlighted context automatically.
   */
  search(jurisdictionId: string, query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return [];

    // Escape FTS5 special characters and build a prefix query
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const rows = this.db.prepare(`
        SELECT
          s.jurisdiction_id,
          s.path,
          s.num,
          s.heading,
          snippet(sections_fts, 2, '', '', '...', 20) as snippet
        FROM sections_fts f
        JOIN sections s ON s.rowid = f.rowid
        WHERE sections_fts MATCH ?
          AND s.jurisdiction_id = ?
        LIMIT ?
      `).all(ftsQuery, jurisdictionId, limit) as any[];

      return rows.map((r: any) => ({
        path: r.path,
        num: r.num || '',
        heading: r.heading || '',
        snippet: r.snippet || '',
        url: `https://openlegalcodes.org/${jurisdictionId}/${r.path}`,
      }));
    } catch {
      // FTS query syntax error — fall back to empty results
      return [];
    }
  }

  hasSearchIndex(jurisdictionId: string): boolean {
    const row = this.db.prepare(
      'SELECT EXISTS(SELECT 1 FROM sections WHERE jurisdiction_id = ? AND text IS NOT NULL) as has_index'
    ).get(jurisdictionId) as { has_index: number };
    return row.has_index === 1;
  }

  listFeedback(filters?: {
    status?: string;
    jurisdictionId?: string;
    limit?: number;
    offset?: number;
  }): FeedbackRow[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.jurisdictionId) {
      conditions.push('jurisdiction_id = ?');
      params.push(filters.jurisdictionId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters?.limit || 50, 200);
    const offset = filters?.offset || 0;
    params.push(limit, offset);

    return this.db.prepare(
      `SELECT * FROM feedback ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params) as FeedbackRow[];
  }

  getFeedback(id: number): FeedbackRow | undefined {
    return this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow | undefined;
  }

  countRecentFeedback(ipAddress: string, windowMinutes: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM feedback
       WHERE ip_address = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
    ).get(ipAddress, windowMinutes) as { cnt: number };
    return row.cnt;
  }
}

export interface FeedbackRow {
  id: number;
  jurisdiction_id: string;
  path: string;
  report_type: string;
  description: string;
  status: string;
  triage_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  ip_address: string | null;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

interface TocNodeRow {
  jurisdiction_id: string;
  path: string;
  slug: string;
  parent_path: string | null;
  level: string;
  num: string;
  heading: string;
  has_content: number;
  sort_order: number;
}

function rowToJurisdiction(row: any): Jurisdiction {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    parentId: row.parent_id,
    fips: row.fips,
    publisher: {
      name: row.publisher_name,
      sourceId: row.publisher_source_id,
      url: row.publisher_url,
    },
    lastCrawled: row.last_crawled,
    lastUpdated: row.last_updated,
  };
}

function rowToTocNode(row: TocNodeRow, childRows?: TocNodeRow[]): TocNode {
  const node: TocNode = {
    slug: row.slug,
    path: row.path,
    level: row.level as any,
    num: row.num,
    heading: row.heading,
    hasContent: row.has_content === 1,
  };

  if (childRows && childRows.length > 0) {
    node.children = childRows.map(r => rowToTocNode(r));
  }

  return node;
}

function buildTocTree(rows: TocNodeRow[], title: string): TocTree {
  // Build a map of path → node with empty children arrays
  const nodeMap = new Map<string, TocNode & { children: TocNode[] }>();

  for (const row of rows) {
    nodeMap.set(row.path, {
      slug: row.slug,
      path: row.path,
      level: row.level as any,
      num: row.num,
      heading: row.heading,
      hasContent: row.has_content === 1,
      children: [],
    });
  }

  // Build tree by linking children to parents
  const roots: TocNode[] = [];
  for (const row of rows) {
    const node = nodeMap.get(row.path)!;
    if (row.parent_path === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(row.parent_path);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphaned node — attach to root
        roots.push(node);
      }
    }
  }

  // Strip empty children arrays to match the original format
  function cleanChildren(node: TocNode): void {
    if (node.children && node.children.length === 0) {
      delete node.children;
    } else if (node.children) {
      node.children.forEach(cleanChildren);
    }
  }
  roots.forEach(cleanChildren);

  return { jurisdiction: '', title, children: roots };
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 * Wraps each token in quotes to treat them as literals,
 * avoiding syntax errors from special characters.
 */
function sanitizeFtsQuery(query: string): string {
  // Split into tokens, wrap each in double quotes for literal matching
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}

// Lazy singleton — DB connection deferred until first use.
// Properties are writable+configurable so vi.spyOn() works.
let _store: CodeStore | null = null;
function getStore(): CodeStore {
  if (!_store) _store = new CodeStore();
  return _store;
}

export const store: CodeStore = Object.create(CodeStore.prototype, {
  initialize: { value() { getStore().initialize(); }, writable: true, configurable: true },
  loadOneJurisdiction: { value(id: string) { getStore().loadOneJurisdiction(id); }, writable: true, configurable: true },
  getJurisdiction: { value(id: string) { return getStore().getJurisdiction(id); }, writable: true, configurable: true },
  listJurisdictions: { value(f?: any) { return getStore().listJurisdictions(f); }, writable: true, configurable: true },
  getToc: { value(id: string) { return getStore().getToc(id); }, writable: true, configurable: true },
  hasUsableToc: { value(id: string) { return getStore().hasUsableToc(id); }, writable: true, configurable: true },
  getTocNode: { value(id: string, p: string) { return getStore().getTocNode(id, p); }, writable: true, configurable: true },
  getCodeText: { value(id: string, p: string) { return getStore().getCodeText(id, p); }, writable: true, configurable: true },
  getCodeHtml: { value(id: string, p: string) { return getStore().getCodeHtml(id, p); }, writable: true, configurable: true },
  getCodeXml: { value(id: string, p: string) { return getStore().getCodeXml(id, p); }, writable: true, configurable: true },
  search: { value(id: string, q: string, l?: number) { return getStore().search(id, q, l); }, writable: true, configurable: true },
  hasSearchIndex: { value(id: string) { return getStore().hasSearchIndex(id); }, writable: true, configurable: true },
  listFeedback: { value(f?: any) { return getStore().listFeedback(f); }, writable: true, configurable: true },
  getFeedback: { value(id: number) { return getStore().getFeedback(id); }, writable: true, configurable: true },
  countRecentFeedback: { value(ip: string, m: number) { return getStore().countRecentFeedback(ip, m); }, writable: true, configurable: true },
});

