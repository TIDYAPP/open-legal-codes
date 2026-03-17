import { describe, expect, it } from 'vitest';
import { TnStatutesCrawler } from '../crawlers/tn-statutes.js';

const SAMPLE_TOC = `
  <html>
    <head><title>Tennessee Code Unannotated - Free Public Access | Main Page</title></head>
    <body>
      <ul class="toclist toc-tree js-toc-tree">
        <li
          class="js-node toc-tree__item is-collapsed"
          data-nodeid="AAB"
          data-nodepath="/ROOT/AAB"
          data-level="1"
          data-haschildren="true"
          data-populated="false"
          data-title="Title 1 Code And Statutes"
          data-docfullpath=""
        ></li>
        <li
          class="js-node toc-tree__item is-collapsed"
          data-nodeid="AAC"
          data-nodepath="/ROOT/AAC"
          data-level="1"
          data-haschildren="true"
          data-populated="false"
          data-title="Title 2 Elections"
          data-docfullpath=""
        ></li>
      </ul>
    </body>
  </html>
`;

describe('TnStatutesCrawler', () => {
  it('parses rendered Lexis title nodes into a TOC', async () => {
    const crawler = new TnStatutesCrawler({
      getHtml: async () => SAMPLE_TOC,
    } as any);

    const toc = await crawler.fetchToc('tn-statutes');

    expect(toc).toEqual([
      {
        id: '/ROOT/AAB',
        title: 'Title 1 Code And Statutes',
        level: 'title',
        hasContent: false,
        children: [],
      },
      {
        id: '/ROOT/AAC',
        title: 'Title 2 Elections',
        level: 'title',
        hasContent: false,
        children: [],
      },
    ]);
  });
});
