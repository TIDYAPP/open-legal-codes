import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MunicodeCrawler } from '../crawlers/municode.js';
import { transformToc, flattenContentNodes } from '../crawlers/toc-transformer.js';
import { CodeWriter } from '../store/writer.js';
import { CodeStore } from '../store/index.js';
import { createDb } from '../store/db.js';
import type Database from 'better-sqlite3';

// Mountain View, CA — ClientID 17072, known to work with Municode API
const SOURCE_ID = '17072';
const JURISDICTION_ID = 'ca-mountain-view';
const JURISDICTION_NAME = 'Mountain View, CA';

// Known node IDs from Mountain View's Municode data
const KNOWN_LEAF_NODE_ID = 'MOUNTAIN_VIEWCICO'; // "MOUNTAIN VIEW - CITY CODE" (no children)
const KNOWN_PARENT_NODE_ID = 'PTITHCH';          // "PART I - THE CHARTER" (has children)

describe.skipIf(!process.env.INTEGRATION)('Municode adapter - live API', () => {
  const crawler = new MunicodeCrawler();

  it('resolve returns productId and jobId', async () => {
    const result = await crawler.resolve(SOURCE_ID);
    expect(result.clientId).toBe(17072);
    expect(result.productId).toBeGreaterThan(0);
    expect(result.jobId).toBeGreaterThan(0);
  }, 15_000);

  it('fetchSection returns HTML for a known leaf node', async () => {
    const content = await crawler.fetchSection(SOURCE_ID, KNOWN_LEAF_NODE_ID);
    expect(content.html.length).toBeGreaterThan(0);
    expect(content.html).toContain('Mountain View');
    expect(content.fetchedAt).toBeDefined();
    expect(content.sourceUrl).toContain('api.municode.com');
  }, 15_000);

});

describe.skipIf(!process.env.INTEGRATION)('Municode - mini crawl round-trip', () => {
  const crawler = new MunicodeCrawler();
  let db: Database.Database;

  beforeAll(() => {
    db = createDb(':memory:');
  });

  afterAll(() => {
    db?.close();
  });

  it('fetches a section, writes to DB, reads back through CodeStore', async () => {
    // Fetch section content
    const content = await crawler.fetchSection(SOURCE_ID, KNOWN_LEAF_NODE_ID);
    expect(content.html.length).toBeGreaterThan(0);

    // Create a minimal TOC with just this one node
    const rawToc = [{
      id: KNOWN_LEAF_NODE_ID,
      title: 'MOUNTAIN VIEW - CITY CODE',
      level: 'part',
      hasContent: true,
      children: [],
    }];
    const tocTree = transformToc(rawToc, JURISDICTION_ID, JURISDICTION_NAME);
    expect(tocTree.children.length).toBe(1);

    // Write jurisdiction, TOC, and section to SQLite
    const writer = new CodeWriter(db);

    await writer.updateRegistry({
      id: JURISDICTION_ID,
      name: JURISDICTION_NAME,
      type: 'city',
      state: 'CA',
      parentId: 'ca',
      fips: '0649670',
      publisher: { name: 'municode', sourceId: SOURCE_ID, url: '' },
      lastCrawled: '',
      lastUpdated: '',
    } as any);

    await writer.writeToc(JURISDICTION_ID, tocTree);

    // Convert and write section
    const contentNodes = flattenContentNodes(tocTree);
    expect(contentNodes.length).toBe(1);

    const node = contentNodes[0];
    const { htmlToUslm } = await import('../converter/html-to-uslm.js');
    const xml = htmlToUslm(content.html, {
      jurisdictionId: JURISDICTION_ID,
      parentPath: '',
      sectionNum: node.num,
      heading: node.heading,
    });

    await writer.writeSection(JURISDICTION_ID, node.path, xml, content.html);

    // Read back through CodeStore
    const store = new CodeStore(db);

    const jurisdiction = store.getJurisdiction(JURISDICTION_ID);
    expect(jurisdiction).toBeDefined();
    expect(jurisdiction!.name).toBe(JURISDICTION_NAME);

    const storedToc = store.getToc(JURISDICTION_ID);
    expect(storedToc).toBeDefined();
    expect(storedToc!.children.length).toBe(1);

    const text = store.getCodeText(JURISDICTION_ID, node.path);
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).toContain('Mountain View');

    const html = store.getCodeHtml(JURISDICTION_ID, node.path);
    expect(html).toBeDefined();

    const storedXml = store.getCodeXml(JURISDICTION_ID, node.path);
    expect(storedXml).toBeDefined();
    expect(storedXml).toContain('<?xml');
  }, 30_000);
});
