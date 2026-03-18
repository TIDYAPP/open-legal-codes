#!/usr/bin/env npx tsx
/**
 * Test: How far back does CourtListener data go?
 * Check oldest opinions for various statutes.
 */

export {};

const token = process.env.COURTLISTENER_API_TOKEN;
if (!token) { console.error('Set COURTLISTENER_API_TOKEN'); process.exit(1); }

const headers: Record<string, string> = {
  Authorization: `Token ${token}`,
  'User-Agent': 'OpenLegalCodes/0.1',
};

async function checkHistory(label: string, query: string) {
  // Get oldest first
  const oldestUrl = `https://www.courtlistener.com/api/rest/v4/search/?` + new URLSearchParams({
    q: query,
    type: 'o',
    order_by: 'dateFiled asc',
    page_size: '3',
  }).toString();

  // Get newest
  const newestUrl = `https://www.courtlistener.com/api/rest/v4/search/?` + new URLSearchParams({
    q: query,
    type: 'o',
    order_by: 'dateFiled desc',
    page_size: '3',
  }).toString();

  const [oldestRes, newestRes] = await Promise.all([
    fetch(oldestUrl, { headers }).then(r => r.json()) as Promise<any>,
    fetch(newestUrl, { headers }).then(r => r.json()) as Promise<any>,
  ]);

  console.log(`\n${label}`);
  console.log(`  Total: ${oldestRes.count} opinions`);

  if (oldestRes.results?.length > 0) {
    console.log(`  Oldest:`);
    for (const r of oldestRes.results) {
      console.log(`    ${r.dateFiled} | ${r.court} | ${r.caseName}`);
    }
  }

  if (newestRes.results?.length > 0) {
    console.log(`  Newest:`);
    for (const r of newestRes.results) {
      console.log(`    ${r.dateFiled} | ${r.court} | ${r.caseName}`);
    }
  }

  // Check decade distribution - sample a few date ranges
  const decades = ['1900-01-01', '1950-01-01', '1970-01-01', '1990-01-01', '2000-01-01', '2010-01-01', '2020-01-01'];
  console.log(`  By decade:`);
  for (let i = 0; i < decades.length - 1; i++) {
    const rangeUrl = `https://www.courtlistener.com/api/rest/v4/search/?` + new URLSearchParams({
      q: query,
      type: 'o',
      filed_after: decades[i],
      filed_before: decades[i + 1],
      page_size: '1',
    }).toString();
    const rangeRes = await fetch(rangeUrl, { headers }).then(r => r.json()) as any;
    const startYear = decades[i].substring(0, 4);
    const endYear = decades[i + 1].substring(0, 4);
    console.log(`    ${startYear}-${endYear}: ${rangeRes.count} opinions`);
  }
  // 2020-present
  const recentUrl = `https://www.courtlistener.com/api/rest/v4/search/?` + new URLSearchParams({
    q: query,
    type: 'o',
    filed_after: '2020-01-01',
    page_size: '1',
  }).toString();
  const recentRes = await fetch(recentUrl, { headers }).then(r => r.json()) as any;
  console.log(`    2020-now: ${recentRes.count} opinions`);
}

await checkHistory('42 U.S.C. § 1983 (civil rights)', '"42 U.S.C. § 1983"');
await checkHistory('15 U.S.C. § 1125 (Lanham Act)', '"15 U.S.C. § 1125"');
await checkHistory('Cal. Penal Code § 187 (murder)', '"Cal. Penal Code § 187"');
await checkHistory('N.Y. Penal Law § 120.05 (assault)', '"N.Y. Penal Law § 120.05"');

console.log('\nDone.');
