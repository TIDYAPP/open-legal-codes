/**
 * SQLite database initialization and schema management.
 *
 * Uses better-sqlite3 for synchronous access — matches the existing
 * CodeStore's synchronous API and avoids async overhead for simple reads.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let _db: Database.Database | null = null;

function openDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = dbPath.replace(/\/[^/]+$/, '');
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Get or create the singleton database connection.
 * The path is only used on first call — subsequent calls return the existing connection.
 */
export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  _db = openDb(dbPath || join(process.cwd(), 'data', 'openlegalcodes.db'));
  return _db;
}

/**
 * Create a new, independent database connection (for tests or migration scripts).
 * Does NOT use the singleton — caller owns the lifecycle.
 */
export function createDb(dbPath: string): Database.Database {
  return openDb(dbPath);
}

/** Reset the singleton (for tests). */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Cached jurisdictions
    CREATE TABLE IF NOT EXISTS jurisdictions (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL,
      state               TEXT,
      parent_id           TEXT,
      fips                TEXT,
      publisher_name      TEXT NOT NULL,
      publisher_source_id TEXT NOT NULL,
      publisher_url       TEXT NOT NULL,
      last_crawled        TEXT NOT NULL DEFAULT '',
      last_updated        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_jurisdictions_state ON jurisdictions(state);
    CREATE INDEX IF NOT EXISTS idx_jurisdictions_type ON jurisdictions(type);
    CREATE INDEX IF NOT EXISTS idx_jurisdictions_publisher ON jurisdictions(publisher_name);

    -- Codes per jurisdiction (one jurisdiction can have multiple codes)
    CREATE TABLE IF NOT EXISTS codes (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL,
      name            TEXT NOT NULL,
      source_id       TEXT,
      source_url      TEXT,
      last_crawled    TEXT NOT NULL DEFAULT '',
      last_updated    TEXT NOT NULL DEFAULT '',
      is_primary      INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jurisdiction_id, code_id),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );

    -- TOC tree (flattened with parent references)
    CREATE TABLE IF NOT EXISTS toc_nodes (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      path            TEXT NOT NULL,
      slug            TEXT NOT NULL,
      parent_path     TEXT,
      level           TEXT NOT NULL,
      num             TEXT NOT NULL DEFAULT '',
      heading         TEXT NOT NULL DEFAULT '',
      has_content     INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jurisdiction_id, code_id, path),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_toc_parent ON toc_nodes(jurisdiction_id, code_id, parent_path);

    -- Code content
    CREATE TABLE IF NOT EXISTS sections (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      path            TEXT NOT NULL,
      html            TEXT,
      xml             TEXT,
      text            TEXT,
      num             TEXT,
      heading         TEXT,
      fetched_at      TEXT,
      PRIMARY KEY (jurisdiction_id, code_id, path),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );

    -- Court decisions (one row per unique CourtListener opinion cluster)
    CREATE TABLE IF NOT EXISTS court_decisions (
      cluster_id      INTEGER PRIMARY KEY,
      case_name       TEXT NOT NULL,
      court           TEXT NOT NULL,
      date_filed      TEXT NOT NULL,
      url             TEXT NOT NULL,
      citation        TEXT,
      cite_count      INTEGER NOT NULL DEFAULT 0,
      fetched_at      TEXT NOT NULL
    );

    -- Many-to-many: which decisions cite which statutes
    CREATE TABLE IF NOT EXISTS court_decision_statute_references (
      cluster_id      INTEGER NOT NULL REFERENCES court_decisions(cluster_id),
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      section_path    TEXT NOT NULL,
      snippet         TEXT,
      PRIMARY KEY (cluster_id, jurisdiction_id, code_id, section_path)
    );
    CREATE INDEX IF NOT EXISTS idx_refs_by_statute
      ON court_decision_statute_references(jurisdiction_id, code_id, section_path);

    -- Search tracking: when did we last check CourtListener for each statute?
    CREATE TABLE IF NOT EXISTS caselaw_search_log (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      section_path    TEXT NOT NULL,
      queries         TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      total_count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jurisdiction_id, code_id, section_path)
    );

    -- User feedback / issue reports
    CREATE TABLE IF NOT EXISTS feedback (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      path            TEXT NOT NULL,
      report_type     TEXT NOT NULL CHECK(report_type IN ('bad_citation','out_of_date','wrong_text','other')),
      description     TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewing','resolved','dismissed')),
      triage_notes    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at     TEXT,
      ip_address      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_jurisdiction ON feedback(jurisdiction_id);
  `);

  // Migration: add code_id to existing tables that don't have it yet
  migrateAddCodeId(db);

  // Migrate from old flat caselaw tables to normalized schema
  const hasOldTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='caselaw_cache'"
  ).get();
  if (hasOldTable) {
    db.exec(`
      DROP TABLE IF EXISTS caselaw_results;
      DROP TABLE IF EXISTS caselaw_cache;
    `);
  }

  // Remove FK constraint from court_decision_statute_references (path may not exist in sections)
  const refTableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='court_decision_statute_references'"
  ).get() as { sql: string } | undefined;
  if (refTableSql?.sql?.includes('REFERENCES sections')) {
    db.exec(`
      DROP TABLE IF EXISTS court_decision_statute_references;
      CREATE TABLE court_decision_statute_references (
        cluster_id      INTEGER NOT NULL REFERENCES court_decisions(cluster_id),
        jurisdiction_id TEXT NOT NULL,
        code_id         TEXT NOT NULL DEFAULT '_default',
        section_path    TEXT NOT NULL,
        snippet         TEXT,
        PRIMARY KEY (cluster_id, jurisdiction_id, code_id, section_path)
      );
      CREATE INDEX IF NOT EXISTS idx_refs_by_statute
        ON court_decision_statute_references(jurisdiction_id, code_id, section_path);
    `);
  }


  // FTS5 virtual table — CREATE VIRTUAL TABLE doesn't support IF NOT EXISTS,
  // so we check for existence first.
  const hasFts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sections_fts'"
  ).get();

  if (!hasFts) {
    db.exec(`
      CREATE VIRTUAL TABLE sections_fts USING fts5(
        num,
        heading,
        text,
        content=sections,
        content_rowid=rowid
      );

      -- Keep FTS in sync with sections table
      CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
        INSERT INTO sections_fts(rowid, num, heading, text)
        VALUES (new.rowid, new.num, new.heading, new.text);
      END;

      CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, num, heading, text)
        VALUES ('delete', old.rowid, old.num, old.heading, old.text);
      END;

      CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, num, heading, text)
        VALUES ('delete', old.rowid, old.num, old.heading, old.text);
        INSERT INTO sections_fts(rowid, num, heading, text)
        VALUES (new.rowid, new.num, new.heading, new.text);
      END;
    `);
  }
}

/**
 * Migrate existing databases: add code_id columns to tables that predate multi-code support.
 * Uses the rename-recreate pattern since SQLite can't alter primary keys.
 */
function migrateAddCodeId(db: Database.Database): void {
  // Check if migration is needed by looking at toc_nodes schema
  const tocSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='toc_nodes'"
  ).get() as { sql: string } | undefined;

  if (!tocSql || tocSql.sql.includes('code_id')) return; // Already migrated or new DB

  // Temporarily disable FK checks for migration
  db.pragma('foreign_keys = OFF');

  db.exec(`
    -- Migrate toc_nodes
    ALTER TABLE toc_nodes RENAME TO toc_nodes_old;
    CREATE TABLE toc_nodes (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      path            TEXT NOT NULL,
      slug            TEXT NOT NULL,
      parent_path     TEXT,
      level           TEXT NOT NULL,
      num             TEXT NOT NULL DEFAULT '',
      heading         TEXT NOT NULL DEFAULT '',
      has_content     INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jurisdiction_id, code_id, path),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );
    INSERT INTO toc_nodes (jurisdiction_id, code_id, path, slug, parent_path, level, num, heading, has_content, sort_order)
      SELECT jurisdiction_id, '_default', path, slug, parent_path, level, num, heading, has_content, sort_order FROM toc_nodes_old;
    DROP TABLE toc_nodes_old;
    CREATE INDEX IF NOT EXISTS idx_toc_parent ON toc_nodes(jurisdiction_id, code_id, parent_path);

    -- Migrate sections
    ALTER TABLE sections RENAME TO sections_old;
    CREATE TABLE sections (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      path            TEXT NOT NULL,
      html            TEXT,
      xml             TEXT,
      text            TEXT,
      num             TEXT,
      heading         TEXT,
      fetched_at      TEXT,
      PRIMARY KEY (jurisdiction_id, code_id, path),
      FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id)
    );
    INSERT INTO sections (jurisdiction_id, code_id, path, html, xml, text, num, heading, fetched_at)
      SELECT jurisdiction_id, '_default', path, html, xml, text, num, heading, fetched_at FROM sections_old;
    DROP TABLE sections_old;

    -- Migrate court_decision_statute_references
    ALTER TABLE court_decision_statute_references RENAME TO court_decision_statute_references_old;
    CREATE TABLE court_decision_statute_references (
      cluster_id      INTEGER NOT NULL REFERENCES court_decisions(cluster_id),
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      section_path    TEXT NOT NULL,
      snippet         TEXT,
      PRIMARY KEY (cluster_id, jurisdiction_id, code_id, section_path)
    );
    INSERT INTO court_decision_statute_references (cluster_id, jurisdiction_id, code_id, section_path, snippet)
      SELECT cluster_id, jurisdiction_id, '_default', section_path, snippet FROM court_decision_statute_references_old;
    DROP TABLE court_decision_statute_references_old;
    CREATE INDEX IF NOT EXISTS idx_refs_by_statute
      ON court_decision_statute_references(jurisdiction_id, code_id, section_path);

    -- Migrate caselaw_search_log
    ALTER TABLE caselaw_search_log RENAME TO caselaw_search_log_old;
    CREATE TABLE caselaw_search_log (
      jurisdiction_id TEXT NOT NULL,
      code_id         TEXT NOT NULL DEFAULT '_default',
      section_path    TEXT NOT NULL,
      queries         TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      total_count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (jurisdiction_id, code_id, section_path)
    );
    INSERT INTO caselaw_search_log (jurisdiction_id, code_id, section_path, queries, last_checked_at, total_count)
      SELECT jurisdiction_id, '_default', section_path, queries, last_checked_at, total_count FROM caselaw_search_log_old;
    DROP TABLE caselaw_search_log_old;

    -- Migrate feedback (simple ALTER — no PK change)
    ALTER TABLE feedback ADD COLUMN code_id TEXT NOT NULL DEFAULT '_default';

    -- Create default code rows for existing crawled jurisdictions
    INSERT OR IGNORE INTO codes (jurisdiction_id, code_id, name, is_primary, sort_order)
      SELECT id, '_default', name, 1, 0 FROM jurisdictions
      WHERE EXISTS (SELECT 1 FROM toc_nodes WHERE jurisdiction_id = jurisdictions.id);
  `);

  // Rebuild FTS5 — triggers reference the old sections table which was dropped
  db.exec(`
    DROP TRIGGER IF EXISTS sections_ai;
    DROP TRIGGER IF EXISTS sections_ad;
    DROP TRIGGER IF EXISTS sections_au;
    DROP TABLE IF EXISTS sections_fts;

    CREATE VIRTUAL TABLE sections_fts USING fts5(
      num, heading, text,
      content=sections, content_rowid=rowid
    );

    -- Rebuild FTS index from migrated data
    INSERT INTO sections_fts(rowid, num, heading, text)
      SELECT rowid, num, heading, text FROM sections;

    CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
      INSERT INTO sections_fts(rowid, num, heading, text)
      VALUES (new.rowid, new.num, new.heading, new.text);
    END;

    CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts, rowid, num, heading, text)
      VALUES ('delete', old.rowid, old.num, old.heading, old.text);
    END;

    CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts, rowid, num, heading, text)
      VALUES ('delete', old.rowid, old.num, old.heading, old.text);
      INSERT INTO sections_fts(rowid, num, heading, text)
      VALUES (new.rowid, new.num, new.heading, new.text);
    END;
  `);

  db.pragma('foreign_keys = ON');
}
