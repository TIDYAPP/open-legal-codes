import type Database from 'better-sqlite3';
import type { Jurisdiction, TocTree, TocNode, Code } from '../types.js';
import { getDb } from './db.js';
export interface SearchResult {
  path: string;
  num: string;
  heading: string;
  snippet: string;
  url: string;
  codeId?: string;
}

/**
 * CodeStore — reads jurisdiction metadata, TOC trees, and code content from SQLite.
 *
 * All reads go directly to SQLite (WAL mode enables concurrent reads).
 * Search uses FTS5 full-text search.
 *
 * Methods accept an optional codeId parameter. When omitted, the primary/default
 * code for the jurisdiction is used (backwards compatible).
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

  /** Resolve a codeId: use provided value, or find the primary/default code. */
  resolveCodeId(jurisdictionId: string, codeId?: string): string {
    if (codeId) return codeId;
    const primary = this.db.prepare(
      'SELECT code_id FROM codes WHERE jurisdiction_id = ? AND is_primary = 1'
    ).get(jurisdictionId) as { code_id: string } | undefined;
    if (primary) return primary.code_id;
    const first = this.db.prepare(
      'SELECT code_id FROM codes WHERE jurisdiction_id = ? ORDER BY sort_order LIMIT 1'
    ).get(jurisdictionId) as { code_id: string } | undefined;
    return first?.code_id || '_default';
  }

  // ---------------------------------------------------------------------------
  // Codes
  // ---------------------------------------------------------------------------

  listCodes(jurisdictionId: string): Code[] {
    const rows = this.db.prepare(
      'SELECT * FROM codes WHERE jurisdiction_id = ? ORDER BY sort_order'
    ).all(jurisdictionId) as any[];
    return rows.map(rowToCode);
  }

  getCode(jurisdictionId: string, codeId: string): Code | undefined {
    const row = this.db.prepare(
      'SELECT * FROM codes WHERE jurisdiction_id = ? AND code_id = ?'
    ).get(jurisdictionId, codeId) as any;
    return row ? rowToCode(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Jurisdictions
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // TOC
  // ---------------------------------------------------------------------------

  getToc(jurisdictionId: string, codeId?: string): TocTree | undefined {
    const effectiveCodeId = this.resolveCodeId(jurisdictionId, codeId);
    const rows = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ? ORDER BY sort_order'
    ).all(jurisdictionId, effectiveCodeId) as TocNodeRow[];

    if (rows.length === 0) return undefined;

    const jurisdiction = this.getJurisdiction(jurisdictionId);
    const code = this.getCode(jurisdictionId, effectiveCodeId);
    const title = code?.name || jurisdiction?.name || jurisdictionId;
    const tree = buildTocTree(rows, title);
    tree.jurisdiction = jurisdictionId;
    tree.codeId = effectiveCodeId;
    return tree;
  }

  hasUsableToc(jurisdictionId: string, codeId?: string): boolean {
    if (codeId) {
      const row = this.db.prepare(
        'SELECT EXISTS(SELECT 1 FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ?) as has_toc'
      ).get(jurisdictionId, codeId) as { has_toc: number };
      return row.has_toc === 1;
    }
    const row = this.db.prepare(
      'SELECT EXISTS(SELECT 1 FROM toc_nodes WHERE jurisdiction_id = ?) as has_toc'
    ).get(jurisdictionId) as { has_toc: number };
    return row.has_toc === 1;
  }

  getTocNode(jurisdictionId: string, codePath: string, codeId?: string): TocNode | undefined {
    const effectiveCodeId = this.resolveCodeId(jurisdictionId, codeId);
    const row = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
    ).get(jurisdictionId, effectiveCodeId, codePath) as TocNodeRow | undefined;

    if (!row) return undefined;

    // Also fetch children
    const children = this.db.prepare(
      'SELECT * FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ? AND parent_path = ? ORDER BY sort_order'
    ).all(jurisdictionId, effectiveCodeId, codePath) as TocNodeRow[];

    return rowToTocNode(row, children);
  }

  // ---------------------------------------------------------------------------
  // Code Content
  // ---------------------------------------------------------------------------

  getCodeText(jurisdictionId: string, codePath: string, codeId?: string): string | null {
    const effectiveCodeId = this.resolveCodeId(jurisdictionId, codeId);
    const row = this.db.prepare(
      'SELECT text FROM sections WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
    ).get(jurisdictionId, effectiveCodeId, codePath) as { text: string | null } | undefined;
    return row?.text ?? null;
  }

  getCodeHtml(jurisdictionId: string, codePath: string, codeId?: string): string | null {
    const effectiveCodeId = this.resolveCodeId(jurisdictionId, codeId);
    const row = this.db.prepare(
      'SELECT html FROM sections WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
    ).get(jurisdictionId, effectiveCodeId, codePath) as { html: string | null } | undefined;
    return row?.html ?? null;
  }

  getCodeXml(jurisdictionId: string, codePath: string, codeId?: string): string | null {
    const effectiveCodeId = this.resolveCodeId(jurisdictionId, codeId);
    const row = this.db.prepare(
      'SELECT xml FROM sections WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
    ).get(jurisdictionId, effectiveCodeId, codePath) as { xml: string | null } | undefined;
    return row?.xml ?? null;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  /**
   * Full-text search using FTS5.
   * When codeId is provided, searches within that code only.
   * When omitted, searches across all codes for the jurisdiction.
   */
  search(jurisdictionId: string, query: string, limit = 20, codeId?: string): SearchResult[] {
    if (!query.trim()) return [];

    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const effectiveCodeId = codeId ? codeId : undefined;
      const codeFilter = effectiveCodeId ? 'AND s.code_id = ?' : '';
      const params: any[] = [ftsQuery, jurisdictionId];
      if (effectiveCodeId) params.push(effectiveCodeId);
      params.push(limit);

      const rows = this.db.prepare(`
        SELECT
          s.jurisdiction_id,
          s.code_id,
          s.path,
          s.num,
          s.heading,
          snippet(sections_fts, 2, '', '', '...', 20) as snippet
        FROM sections_fts f
        JOIN sections s ON s.rowid = f.rowid
        WHERE sections_fts MATCH ?
          AND s.jurisdiction_id = ?
          ${codeFilter}
        LIMIT ?
      `).all(...params) as any[];

      return rows.map((r: any) => ({
        path: r.path,
        num: r.num || '',
        heading: r.heading || '',
        snippet: r.snippet || '',
        url: `https://openlegalcodes.org/${jurisdictionId}/${r.path}`,
        codeId: r.code_id !== '_default' ? r.code_id : undefined,
      }));
    } catch {
      return [];
    }
  }

  hasSearchIndex(jurisdictionId: string, codeId?: string): boolean {
    if (codeId) {
      const row = this.db.prepare(
        'SELECT EXISTS(SELECT 1 FROM sections WHERE jurisdiction_id = ? AND code_id = ? AND text IS NOT NULL) as has_index'
      ).get(jurisdictionId, codeId) as { has_index: number };
      return row.has_index === 1;
    }
    const row = this.db.prepare(
      'SELECT EXISTS(SELECT 1 FROM sections WHERE jurisdiction_id = ? AND text IS NOT NULL) as has_index'
    ).get(jurisdictionId) as { has_index: number };
    return row.has_index === 1;
  }

  // ---------------------------------------------------------------------------
  // Cache Management
  // ---------------------------------------------------------------------------

  /** Delete cached sections and TOC for a jurisdiction (optionally scoped to one code). */
  invalidateCache(jurisdictionId: string, codeId?: string): { deletedSections: number; deletedTocNodes: number } {
    if (codeId) {
      const sections = this.db.prepare('DELETE FROM sections WHERE jurisdiction_id = ? AND code_id = ?').run(jurisdictionId, codeId);
      const tocNodes = this.db.prepare('DELETE FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ?').run(jurisdictionId, codeId);
      return { deletedSections: sections.changes, deletedTocNodes: tocNodes.changes };
    }
    const sections = this.db.prepare('DELETE FROM sections WHERE jurisdiction_id = ?').run(jurisdictionId);
    const tocNodes = this.db.prepare('DELETE FROM toc_nodes WHERE jurisdiction_id = ?').run(jurisdictionId);
    return { deletedSections: sections.changes, deletedTocNodes: tocNodes.changes };
  }

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Annotations
  // ---------------------------------------------------------------------------

  listAnnotations(filters: {
    targetType?: 'section' | 'caselaw';
    jurisdictionId?: string;
    path?: string;
    codeId?: string;
    clusterId?: number;
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): AnnotationRow[] {
    const conditions: string[] = [];
    const params: any[] = [];

    // Default to approved-only for public reads
    const status = filters.status || 'approved';
    conditions.push('status = ?');
    params.push(status);

    if (filters.targetType) {
      conditions.push('target_type = ?');
      params.push(filters.targetType);
    }
    if (filters.jurisdictionId) {
      conditions.push('jurisdiction_id = ?');
      params.push(filters.jurisdictionId);
    }
    if (filters.path) {
      conditions.push('path = ?');
      params.push(filters.path);
    }
    if (filters.codeId) {
      conditions.push('code_id = ?');
      params.push(filters.codeId);
    }
    if (filters.clusterId != null) {
      conditions.push('cluster_id = ?');
      params.push(filters.clusterId);
    }
    if (filters.type) {
      conditions.push('annotation_type = ?');
      params.push(filters.type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;
    params.push(limit, offset);

    return this.db.prepare(
      `SELECT * FROM annotations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params) as AnnotationRow[];
  }

  getAnnotation(id: number): AnnotationRow | undefined {
    return this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as AnnotationRow | undefined;
  }

  countRecentAnnotations(ipAddress: string, windowMinutes: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM annotations
       WHERE ip_address = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
    ).get(ipAddress, windowMinutes) as { cnt: number };
    return row.cnt;
  }

  listTrustedDomains(): TrustedDomainRow[] {
    return this.db.prepare('SELECT * FROM trusted_domains ORDER BY source_type, domain').all() as TrustedDomainRow[];
  }

  isTrustedDomain(domain: string): { trusted: boolean; sourceName?: string; sourceType?: string } {
    // Strip www. prefix
    const cleaned = domain.replace(/^www\./, '');

    // Auto-trust any .gov domain
    if (cleaned.endsWith('.gov')) {
      // Try to find a specific match for the source name
      const exact = this.db.prepare(
        'SELECT source_name, source_type FROM trusted_domains WHERE domain = ?'
      ).get(cleaned) as { source_name: string; source_type: string } | undefined;
      return {
        trusted: true,
        sourceName: exact?.source_name || cleaned,
        sourceType: exact?.source_type || 'government',
      };
    }

    // Load all domains and check suffix match (e.g. blog.lw.com matches lw.com)
    const domains = this.db.prepare('SELECT domain, source_name, source_type FROM trusted_domains').all() as TrustedDomainRow[];
    for (const d of domains) {
      if (cleaned === d.domain || cleaned.endsWith('.' + d.domain)) {
        return { trusted: true, sourceName: d.source_name, sourceType: d.source_type };
      }
    }

    return { trusted: false };
  }
}

export interface FeedbackRow {
  id: number;
  jurisdiction_id: string;
  code_id: string;
  path: string;
  report_type: string;
  description: string;
  status: string;
  triage_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  ip_address: string | null;
}

export interface AnnotationRow {
  id: number;
  target_type: 'section' | 'caselaw';
  jurisdiction_id: string;
  code_id: string;
  path: string;
  cluster_id: number | null;
  url: string;
  title: string;
  source_name: string;
  source_domain: string;
  annotation_type: string;
  description: string;
  status: string;
  triage_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  ip_address: string | null;
}

export interface TrustedDomainRow {
  id: number;
  domain: string;
  source_name: string;
  source_type: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

interface TocNodeRow {
  jurisdiction_id: string;
  code_id: string;
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

function rowToCode(row: any): Code {
  return {
    jurisdictionId: row.jurisdiction_id,
    codeId: row.code_id,
    name: row.name,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    lastCrawled: row.last_crawled,
    lastUpdated: row.last_updated,
    isPrimary: row.is_primary === 1,
    sortOrder: row.sort_order,
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
  resolveCodeId: { value(id: string, codeId?: string) { return getStore().resolveCodeId(id, codeId); }, writable: true, configurable: true },
  listCodes: { value(id: string) { return getStore().listCodes(id); }, writable: true, configurable: true },
  getCode: { value(id: string, codeId: string) { return getStore().getCode(id, codeId); }, writable: true, configurable: true },
  getToc: { value(id: string, codeId?: string) { return getStore().getToc(id, codeId); }, writable: true, configurable: true },
  hasUsableToc: { value(id: string, codeId?: string) { return getStore().hasUsableToc(id, codeId); }, writable: true, configurable: true },
  getTocNode: { value(id: string, p: string, codeId?: string) { return getStore().getTocNode(id, p, codeId); }, writable: true, configurable: true },
  getCodeText: { value(id: string, p: string, codeId?: string) { return getStore().getCodeText(id, p, codeId); }, writable: true, configurable: true },
  getCodeHtml: { value(id: string, p: string, codeId?: string) { return getStore().getCodeHtml(id, p, codeId); }, writable: true, configurable: true },
  getCodeXml: { value(id: string, p: string, codeId?: string) { return getStore().getCodeXml(id, p, codeId); }, writable: true, configurable: true },
  search: { value(id: string, q: string, l?: number, codeId?: string) { return getStore().search(id, q, l, codeId); }, writable: true, configurable: true },
  hasSearchIndex: { value(id: string, codeId?: string) { return getStore().hasSearchIndex(id, codeId); }, writable: true, configurable: true },
  invalidateCache: { value(id: string, codeId?: string) { return getStore().invalidateCache(id, codeId); }, writable: true, configurable: true },
  listFeedback: { value(f?: any) { return getStore().listFeedback(f); }, writable: true, configurable: true },
  getFeedback: { value(id: number) { return getStore().getFeedback(id); }, writable: true, configurable: true },
  countRecentFeedback: { value(ip: string, m: number) { return getStore().countRecentFeedback(ip, m); }, writable: true, configurable: true },
  listAnnotations: { value(f: any) { return getStore().listAnnotations(f); }, writable: true, configurable: true },
  getAnnotation: { value(id: number) { return getStore().getAnnotation(id); }, writable: true, configurable: true },
  countRecentAnnotations: { value(ip: string, m: number) { return getStore().countRecentAnnotations(ip, m); }, writable: true, configurable: true },
  listTrustedDomains: { value() { return getStore().listTrustedDomains(); }, writable: true, configurable: true },
  isTrustedDomain: { value(d: string) { return getStore().isTrustedDomain(d); }, writable: true, configurable: true },
});
