import type Database from 'better-sqlite3';
import type { TocTree, TocNode, Jurisdiction, Code } from '../types.js';
import { getDb } from './db.js';

/**
 * CodeWriter — writes jurisdiction metadata, TOC trees, and code sections to SQLite.
 */
export class CodeWriter {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDb();
  }

  async writeMeta(_jurisdictionId: string, _meta: Record<string, unknown>): Promise<void> {
    // Meta is stored as part of the jurisdiction row — this is a no-op now.
    // The jurisdiction row is created/updated via updateRegistry().
  }

  async writeToc(jurisdictionId: string, tocTree: TocTree, codeId?: string): Promise<void> {
    const effectiveCodeId = codeId || tocTree.codeId || '_default';

    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO toc_nodes
        (jurisdiction_id, code_id, path, slug, parent_path, level, num, heading, has_content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction(() => {
      // Clear existing TOC for this jurisdiction + code
      this.db.prepare('DELETE FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ?')
        .run(jurisdictionId, effectiveCodeId);

      let order = 0;
      const walk = (nodes: TocNode[], parentPath: string | null) => {
        for (const node of nodes) {
          insertNode.run(
            jurisdictionId,
            effectiveCodeId,
            node.path,
            node.slug,
            parentPath,
            node.level,
            node.num || '',
            node.heading || '',
            node.hasContent ? 1 : 0,
            order++,
          );
          if (node.children?.length) {
            walk(node.children, node.path);
          }
        }
      };

      walk(stripSourceIds(tocTree).children, null);
    });

    run();
  }

  async writeSection(
    jurisdictionId: string,
    codePath: string,
    xml: string,
    html: string,
    codeId?: string,
  ): Promise<void> {
    const effectiveCodeId = codeId || '_default';
    const text = stripHtml(html);

    // Try to get num/heading from the TOC node
    const tocNode = this.db.prepare(
      'SELECT num, heading FROM toc_nodes WHERE jurisdiction_id = ? AND code_id = ? AND path = ?'
    ).get(jurisdictionId, effectiveCodeId, codePath) as { num: string; heading: string } | undefined;

    this.db.prepare(`
      INSERT OR REPLACE INTO sections
        (jurisdiction_id, code_id, path, html, xml, text, num, heading, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jurisdictionId,
      effectiveCodeId,
      codePath,
      html,
      xml,
      text,
      tocNode?.num || null,
      tocNode?.heading || null,
      new Date().toISOString(),
    );
  }

  writeCode(jurisdictionId: string, code: Omit<Code, 'jurisdictionId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO codes
        (jurisdiction_id, code_id, name, source_id, source_url, last_crawled, last_updated, is_primary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jurisdictionId,
      code.codeId,
      code.name,
      code.sourceId || null,
      code.sourceUrl || null,
      code.lastCrawled || '',
      code.lastUpdated || '',
      code.isPrimary ? 1 : 0,
      code.sortOrder,
    );
  }

  writeCodes(jurisdictionId: string, codes: Array<Omit<Code, 'jurisdictionId'>>): void {
    const run = this.db.transaction(() => {
      for (const code of codes) {
        this.writeCode(jurisdictionId, code);
      }
    });
    run();
  }

  createFeedback(params: {
    jurisdictionId: string;
    path: string;
    reportType: string;
    description: string;
    ipAddress?: string;
    codeId?: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO feedback (jurisdiction_id, code_id, path, report_type, description, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      params.jurisdictionId,
      params.codeId || '_default',
      params.path,
      params.reportType,
      params.description,
      params.ipAddress || null,
    );
    return Number(result.lastInsertRowid);
  }

  updateFeedbackStatus(id: number, status: string, triageNotes?: string): void {
    const resolvedAt = (status === 'resolved' || status === 'dismissed')
      ? new Date().toISOString()
      : null;
    this.db.prepare(`
      UPDATE feedback SET status = ?, triage_notes = ?, resolved_at = COALESCE(?, resolved_at)
      WHERE id = ?
    `).run(status, triageNotes || null, resolvedAt, id);
  }

  createAnnotation(params: {
    targetType?: 'section' | 'caselaw';
    jurisdictionId: string;
    codeId?: string;
    path?: string;
    clusterId?: number;
    url: string;
    title: string;
    sourceName?: string;
    sourceDomain: string;
    annotationType: string;
    description?: string;
    ipAddress?: string;
    status?: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO annotations
        (target_type, jurisdiction_id, code_id, path, cluster_id, url, title, source_name, source_domain, annotation_type, description, ip_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.targetType || 'section',
      params.jurisdictionId,
      params.codeId || '_default',
      params.path || '',
      params.clusterId ?? null,
      params.url,
      params.title,
      params.sourceName || '',
      params.sourceDomain,
      params.annotationType,
      params.description || '',
      params.ipAddress || null,
      params.status || 'pending',
    );
    return Number(result.lastInsertRowid);
  }

  updateAnnotationStatus(id: number, status: string, triageNotes?: string): void {
    const reviewedAt = (status === 'approved' || status === 'rejected')
      ? new Date().toISOString()
      : null;
    this.db.prepare(`
      UPDATE annotations SET status = ?, triage_notes = ?, reviewed_at = COALESCE(?, reviewed_at)
      WHERE id = ?
    `).run(status, triageNotes || null, reviewedAt, id);
  }

  async updateRegistry(jurisdiction: Jurisdiction): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO jurisdictions
        (id, name, type, state, parent_id, fips,
         publisher_name, publisher_source_id, publisher_url,
         last_crawled, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jurisdiction.id,
      jurisdiction.name,
      jurisdiction.type,
      jurisdiction.state,
      jurisdiction.parentId,
      jurisdiction.fips,
      jurisdiction.publisher.name,
      jurisdiction.publisher.sourceId,
      jurisdiction.publisher.url,
      jurisdiction.lastCrawled,
      jurisdiction.lastUpdated,
    );
  }
}

function stripSourceIds(tree: TocTree): TocTree {
  return {
    ...tree,
    children: tree.children.map(stripNode),
  };
}

function stripNode(node: any): any {
  const { sourceNodeId, children, ...rest } = node;
  return {
    ...rest,
    ...(children?.length ? { children: children.map(stripNode) } : {}),
  };
}

/** Strip HTML tags and decode common entities */
export function stripHtml(html: string): string {
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
