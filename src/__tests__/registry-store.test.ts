import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RegistryStore } from '../registry/store.js';

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'olc-registry-store-'));

beforeAll(() => {
  writeFileSync(join(FIXTURE_DIR, 'registry.json'), '[]');
  writeFileSync(join(FIXTURE_DIR, 'manual-sources.json'), JSON.stringify([
    {
      id: 'tx-travis-county',
      name: 'Travis County, TX',
      type: 'county',
      state: 'TX',
      parentId: 'tx',
      fips: '48453',
      sourceUrl: 'https://www.traviscountytx.gov/commissioners-court/county-code',
      documents: [],
    },
    {
      id: 'az-maricopa-county',
      name: 'Maricopa County, AZ',
      type: 'county',
      state: 'AZ',
      parentId: 'az',
      fips: '04013',
      sourceUrl: 'https://www.maricopa.gov/2271/Ordinances-Regulations-and-Codes',
      documents: [],
    },
  ], null, 2));
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe('RegistryStore manual sources bootstrap', () => {
  const store = new RegistryStore(FIXTURE_DIR);

  beforeAll(() => {
    store.initialize();
  });

  it('loads Travis County as a resolvable manual county entry', () => {
    const entry = store.getById('tx-travis-county');
    expect(entry).toBeDefined();
    expect(entry?.publisher).toBe('manual');
    expect(entry?.status).toBe('available');
    expect(entry?.type).toBe('county');
    expect(entry?.sourceUrl).toBe('https://www.traviscountytx.gov/commissioners-court/county-code');

    const matches = store.findByName('Travis County', 'TX').filter((item) => item.type === 'county');
    expect(matches.map((item) => item.id)).toContain('tx-travis-county');
  });

  it('loads Maricopa County as a resolvable manual county entry', () => {
    const entry = store.getById('az-maricopa-county');
    expect(entry).toBeDefined();
    expect(entry?.publisher).toBe('manual');
    expect(entry?.status).toBe('available');
    expect(entry?.type).toBe('county');
    expect(entry?.sourceUrl).toBe('https://www.maricopa.gov/2271/Ordinances-Regulations-and-Codes');

    const matches = store.findByName('Maricopa County', 'AZ').filter((item) => item.type === 'county');
    expect(matches.map((item) => item.id)).toContain('az-maricopa-county');
  });
});
