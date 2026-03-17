import { describe, expect, it } from 'vitest';
import { ArizonaStatutesCrawler } from '../crawlers/az-statutes.js';
import { RegistryStore } from '../registry/store.js';

const SAMPLE_TOC = `
  <div id="chapter1" class="accordion">
    <h5>
      <a href="">Chapter 1</a>
      <div class="two-thirds">FORMATION</div>
      <div class="one-sixth">Sec: 9-101-9-137</div>
    </h5>
    <div>
      <div class="article">
        <a href="">Article 1</a>
        <span>Incorporation</span>
        <div>
          <ul>
            <li class="colleft"><a class="stat" href="/viewdocument/?docName=https://www.azleg.gov/ars/9/00101.htm">9-101</a></li>
            <li class="colright">Incorporation; definitions</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
`;

describe('ArizonaStatutesCrawler', () => {
  it('lists the Arizona local-government statute titles', async () => {
    const crawler = new ArizonaStatutesCrawler();
    const results = [];
    for await (const jurisdiction of crawler.listJurisdictions()) {
      results.push(jurisdiction);
    }

    expect(results.map((j) => j.id)).toEqual(['az-title-9', 'az-title-11', 'az-title-42']);
    expect(results.map((j) => j.name)).toEqual([
      'Arizona Title 9 - Cities and Towns',
      'Arizona Title 11 - Counties',
      'Arizona Title 42 - Taxation',
    ]);
  });

  it('parses chapter, article, and section nodes from a title page', async () => {
    const crawler = new ArizonaStatutesCrawler({
      getHtml: async () => SAMPLE_TOC,
    } as any);

    const toc = await crawler.fetchToc('9');
    expect(toc).toHaveLength(1);
    expect(toc[0].title).toContain('Chapter 1 - FORMATION');
    expect(toc[0].children).toHaveLength(1);
    expect(toc[0].children[0].title).toBe('Article 1 - Incorporation');
    expect(toc[0].children[0].children[0].id).toBe('https://www.azleg.gov/ars/9/00101.htm');
  });
});

describe('RegistryStore Arizona bootstrap', () => {
  it('adds Arizona state-title entries on initialize', () => {
    const store = new RegistryStore();
    store.initialize();

    const azStates = store.query({ state: 'AZ', type: 'state' }).map((entry) => entry.id);
    expect(azStates).toContain('az-title-9');
    expect(azStates).toContain('az-title-11');
  });
});
