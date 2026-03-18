import type Database from 'better-sqlite3';
import type { TocTree, TocNode, Jurisdiction } from '../types.js';
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

  async writeToc(jurisdictionId: string, tocTree: TocTree): Promise<void> {
    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO toc_nodes
        (jurisdiction_id, path, slug, parent_path, level, num, heading, has_content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = this.db.transaction(() => {
      // Clear existing TOC for this jurisdiction
      this.db.prepare('DELETE FROM toc_nodes WHERE jurisdiction_id = ?').run(jurisdictionId);

      let order = 0;
      const walk = (nodes: TocNode[], parentPath: string | null) => {
        for (const node of nodes) {
          insertNode.run(
            jurisdictionId,
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
  ): Promise<void> {
    const text = stripHtml(html);

    // Try to get num/heading from the TOC node
    const tocNode = this.db.prepare(
      'SELECT num, heading FROM toc_nodes WHERE jurisdiction_id = ? AND path = ?'
    ).get(jurisdictionId, codePath) as { num: string; heading: string } | undefined;

    this.db.prepare(`
      INSERT OR REPLACE INTO sections
        (jurisdiction_id, path, html, xml, text, num, heading, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jurisdictionId,
      codePath,
      html,
      xml,
      text,
      tocNode?.num || null,
      tocNode?.heading || null,
      new Date().toISOString(),
    );
  }

  createFeedback(params: {
    jurisdictionId: string;
    path: string;
    reportType: string;
    description: string;
    ipAddress?: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO feedback (jurisdiction_id, path, report_type, description, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      params.jurisdictionId,
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
