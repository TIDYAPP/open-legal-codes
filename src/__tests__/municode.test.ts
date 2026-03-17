import { describe, expect, it } from 'vitest';
import { MunicodeCrawler } from '../crawlers/municode.js';

describe('MunicodeCrawler.lookupByName', () => {
  it('handles exact-match responses returned as a single object', async () => {
    const crawler = new MunicodeCrawler({
      get: async () => new Response(JSON.stringify({
        ClientID: 1113,
        ClientName: 'Austin',
        State: { StateID: 43, StateName: 'Texas', StateAbbreviation: 'TX' },
        City: 'Austin',
        Website: 'www.austintexas.gov',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      getJson: async () => [],
    } as any);

    const result = await crawler.lookupByName('Austin', 'TX');
    expect(result).toBeTruthy();
    expect(result?.id).toBe('tx-austin');
    expect(result?.publisher.sourceId).toBe('1113');
  });

  it('falls back to the full state client list for county matches', async () => {
    const crawler = new MunicodeCrawler({
      get: async () => new Response(null, { status: 204 }),
      getJson: async () => [
        {
          ClientID: 8080,
          ClientName: 'Maricopa County',
          State: { StateID: 3, StateName: 'Arizona', StateAbbreviation: 'AZ' },
          City: 'Phoenix',
          Website: 'www.maricopa.gov',
        },
      ],
    } as any);

    const result = await crawler.lookupByName('Maricopa County', 'AZ');
    expect(result).toBeTruthy();
    expect(result?.id).toBe('az-maricopa-county');
    expect(result?.type).toBe('county');
    expect(result?.publisher.sourceId).toBe('8080');
  });
});
