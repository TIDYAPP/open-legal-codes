#!/usr/bin/env npx tsx
/**
 * One-time migration script: imports existing filesystem cache into SQLite.
 *
 * Usage: npx tsx src/store/migrate-from-files.ts [--codes-dir ./codes] [--db-path ./data/openlegalcodes.db]
 *
 * Reads:
 *   codes/jurisdictions.json
 *   codes/{id}/_toc.json
 *   codes/{id}/{path}.html
 *   codes/{id}/{path}.xml
 *
 * Writes to SQLite database with all tables populated.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Jurisdiction, TocTree, TocNode } from '../types.js';
import { createDb } from './db.js';
import { stripHtml } from './writer.js';

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const codesDir = getArg('codes-dir') || join(process.cwd(), 'codes');
const dbPath = getArg('db-path') || join(process.cwd(), 'data', 'openlegalcodes.db');

console.log(`[migrate] Codes dir: ${codesDir}`);
console.log(`[migrate] Database: ${dbPath}`);

const registryPath = join(codesDir, 'jurisdictions.json');
if (!existsSync(registryPath)) {
  console.error(`[migrate] No jurisdictions.json found at ${registryPath}`);
  process.exit(1);
}

const jurisdictions: Jurisdiction[] = JSON.parse(readFileSync(registryPath, 'utf-8'));
console.log(`[migrate] Found ${jurisdictions.length} jurisdictions`);

const db = createDb(dbPath);

// Prepared statements
const insertJurisdiction = db.prepare(`
  INSERT OR REPLACE INTO jurisdictions
    (id, name, type, state, parent_id, fips, publisher_name, publisher_source_id, publisher_url, last_crawled, last_updated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTocNode = db.prepare(`
  INSERT OR REPLACE INTO toc_nodes
    (jurisdiction_id, path, slug, parent_path, level, num, heading, has_content, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSection = db.prepare(`
  INSERT OR REPLACE INTO sections
    (jurisdiction_id, path, html, xml, text, num, heading, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalSections = 0;
let totalTocNodes = 0;

const migrate = db.transaction(() => {
  // Insert jurisdictions
  for (const j of jurisdictions) {
    insertJurisdiction.run(
      j.id, j.name, j.type, j.state, j.parentId, j.fips,
      j.publisher.name, j.publisher.sourceId, j.publisher.url,
      j.lastCrawled, j.lastUpdated,
    );
  }

  // Process each jurisdiction
  for (const j of jurisdictions) {
    const tocPath = join(codesDir, j.id, '_toc.json');
    if (!existsSync(tocPath)) continue;

    let toc: TocTree;
    try {
      toc = JSON.parse(readFileSync(tocPath, 'utf-8'));
    } catch {
      console.warn(`[migrate] Skipping ${j.id}: corrupt _toc.json`);
      continue;
    }

    if (!toc.children || toc.children.length === 0) {
      console.warn(`[migrate] Skipping ${j.id}: empty TOC`);
      continue;
    }

    // Flatten and insert TOC nodes
    let order = 0;
    function walkToc(nodes: TocNode[], parentPath: string | null) {
      for (const node of nodes) {
        insertTocNode.run(
          j.id, node.path, node.slug, parentPath,
          node.level, node.num || '', node.heading || '',
          node.hasContent ? 1 : 0, order++,
        );
        totalTocNodes++;
        if (node.children?.length) {
          walkToc(node.children, node.path);
        }
      }
    }
    walkToc(toc.children, null);

    // Import sections (HTML + XML files)
    function walkSections(nodes: TocNode[]) {
      for (const node of nodes) {
        if (node.hasContent) {
          const htmlPath = join(codesDir, j.id, `${node.path}.html`);
          const xmlPath = join(codesDir, j.id, `${node.path}.xml`);

          const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf-8') : null;
          const xml = existsSync(xmlPath) ? readFileSync(xmlPath, 'utf-8') : null;

          if (html || xml) {
            const text = html ? stripHtml(html) : null;
            insertSection.run(
              j.id, node.path, html, xml, text,
              node.num || null, node.heading || null,
              j.lastCrawled || new Date().toISOString(),
            );
            totalSections++;
          }
        }
        if (node.children?.length) {
          walkSections(node.children);
        }
      }
    }
    walkSections(toc.children);

    console.log(`[migrate] ${j.id}: ${order} TOC nodes, sections imported`);
  }
});

migrate();
db.close();

console.log(`\n[migrate] Done.`);
console.log(`[migrate] ${jurisdictions.length} jurisdictions`);
console.log(`[migrate] ${totalTocNodes} TOC nodes`);
console.log(`[migrate] ${totalSections} sections`);
