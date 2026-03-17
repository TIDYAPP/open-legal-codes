import { describe, expect, it } from 'vitest';
import { TexasStatutesCrawler } from '../crawlers/tx-statutes.js';

describe('TexasStatutesCrawler', () => {
  it('parses Local Government Code headings from the TCSS API', async () => {
    const responses = new Map<string, unknown>([
      [
        'https://statutes.capitol.texas.gov/assets/StatuteCodeTree.json',
        { StatuteCode: [{ codeID: '19', code: 'LG', CodeName: 'Local Government Code' }] },
      ],
      [
        'https://tcss.legis.texas.gov/api/StatuteCode/GetTopLevelHeadings/S%2F19/LG/1/true/false',
        [
          {
            name: 'TITLE 2. ORGANIZATION OF MUNICIPAL GOVERNMENT',
            value: '45288.39116',
            valuePath: 'S/19/45288.39116',
            expandable: true,
            pdfLink: null,
            docLink: null,
            htmLink: null,
            children: [
              {
                name: 'SUBTITLE D. GENERAL POWERS OF MUNICIPALITIES',
                value: '45596.39367',
                valuePath: 'S/19/45288.39116/45596.39367',
                expandable: true,
                pdfLink: null,
                docLink: null,
                htmLink: null,
                children: [
                  {
                    name: 'CHAPTER 53. CODE OF MUNICIPAL ORDINANCES',
                    value: '45639.39400',
                    valuePath: 'S/19/45288.39116/45596.39367/45639.39400',
                    expandable: true,
                    pdfLink: '/LG/pdf/LG.53.pdf',
                    docLink: '/LG/word/LG.53.docx',
                    htmLink: '/LG/htm/LG.53.htm',
                    children: null,
                  },
                ],
              },
            ],
          },
        ],
      ],
    ]);

    const http = {
      getJson: async <T>(url: string): Promise<T> => {
        if (!responses.has(url)) {
          throw new Error(`Unexpected URL: ${url}`);
        }
        return responses.get(url) as T;
      },
    };

    const crawler = new TexasStatutesCrawler(http as any);
    const toc = await crawler.fetchToc('LG');

    expect(toc).toHaveLength(1);
    expect(toc[0].title).toBe('TITLE 2. ORGANIZATION OF MUNICIPAL GOVERNMENT');
    expect(toc[0].children[0].level).toBe('subtitle');
    expect(toc[0].children[0].children[0]).toMatchObject({
      title: 'CHAPTER 53. CODE OF MUNICIPAL ORDINANCES',
      level: 'chapter',
      hasContent: true,
      id: 'LG|/LG/pdf/LG.53.pdf',
    });
  });
});
