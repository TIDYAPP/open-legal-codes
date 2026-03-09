import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MunicodeCrawler } from '../crawlers/municode.js';
import { transformToc, flattenContentNodes } from '../crawlers/toc-transformer.js';
import { CodeWriter } from '../store/writer.js';
import { CodeStore } from '../store/index.js';

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
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'olc-test-'));
  });

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fetches a section, writes to disk, reads back through CodeStore', async () => {
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

    // Write TOC, meta, and the section
    const writer = new CodeWriter(tmpDir);
    await writer.writeMeta(JURISDICTION_ID, {
      id: JURISDICTION_ID,
      name: JURISDICTION_NAME,
      type: 'city',
      state: 'CA',
      codeName: `${JURISDICTION_NAME} Municipal Code`,
      publisher: { name: 'municode', sourceId: SOURCE_ID, url: '' },
    });
    await writer.writeToc(JURISDICTION_ID, tocTree);

    // Write jurisdictions.json for CodeStore
    await writeFile(
      join(tmpDir, 'jurisdictions.json'),
      JSON.stringify([{
        id: JURISDICTION_ID,
        name: JURISDICTION_NAME,
        type: 'city',
        state: 'CA',
        parentId: 'ca',
        fips: '0649670',
        publisher: { name: 'municode', sourceId: SOURCE_ID, url: '' },
        lastCrawled: '',
        lastUpdated: '',
      }]),
    );

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

    // Verify files exist
    expect(existsSync(join(tmpDir, JURISDICTION_ID, '_meta.json'))).toBe(true);
    expect(existsSync(join(tmpDir, JURISDICTION_ID, '_toc.json'))).toBe(true);
    expect(existsSync(join(tmpDir, JURISDICTION_ID, `${node.path}.html`))).toBe(true);
    expect(existsSync(join(tmpDir, JURISDICTION_ID, `${node.path}.xml`))).toBe(true);

    // Read back through CodeStore
    const store = new CodeStore(tmpDir);
    store.initialize();

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
