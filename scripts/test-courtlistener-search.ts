#!/usr/bin/env npx tsx
/**
 * Test: Does CourtListener return relevant opinions when we search for a statute citation?
 * Try several different statutes across federal and state law.
 */

const token = process.env.COURTLISTENER_API_TOKEN;
if (!token) { console.error('Set COURTLISTENER_API_TOKEN'); process.exit(1); }

const headers: Record<string, string> = {
  Authorization: `Token ${token}`,
  'User-Agent': 'OpenLegalCodes/0.1',
};

async function searchStatute(label: string, query: string) {
  const url = `https://www.courtlistener.com/api/rest/v4/search/?` + new URLSearchParams({
    q: query,
    type: 'o',
    order_by: 'dateFiled desc',
    page_size: '5',
  }).toString();

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.log(`  ERROR ${res.status}: ${await res.text()}\n`);
    return;
  }
  const data = await res.json() as any;

  console.log(`\n${label}`);
  console.log(`  Query: ${query}`);
  console.log(`  Total results: ${data.count}`);
  console.log(`  Recent opinions:`);

  for (const r of data.results.slice(0, 5)) {
    const snippet = r.snippet
      ? r.snippet.replace(/<[^>]+>/g, '').substring(0, 120)
      : '(no snippet)';
    console.log(`    ${r.dateFiled} | ${r.court} | ${r.caseName}`);
    console.log(`      ${snippet}`);
  }
}

// Federal statutes
await searchStatute(
  '1. 42 U.S.C. § 1983 (civil rights — most cited)',
  '"42 U.S.C. § 1983"'
);

await searchStatute(
  '2. 26 U.S.C. § 501 (tax-exempt organizations)',
  '"26 U.S.C. § 501"'
);

await searchStatute(
  '3. 42 U.S.C. § 2000e (Title VII employment discrimination)',
  '"42 U.S.C. § 2000e"'
);

// CFR (federal regulations)
await searchStatute(
  '4. 29 C.F.R. § 1630 (ADA regulations)',
  '"29 C.F.R. § 1630"'
);

// California state statute
await searchStatute(
  '5. Cal. Gov. Code § 12940 (CA fair employment)',
  '"Cal. Gov. Code § 12940"'
);

await searchStatute(
  '6. Cal. Penal Code § 187 (murder)',
  '"Cal. Penal Code § 187"'
);

// New York
await searchStatute(
  '7. N.Y. Penal Law § 120.05 (assault 2nd degree)',
  '"N.Y. Penal Law § 120.05"'
);

// Try a less common one
await searchStatute(
  '8. 15 U.S.C. § 1125 (Lanham Act - trademark)',
  '"15 U.S.C. § 1125"'
);

// Try different citation formats for same statute
console.log('\n\n=== Format variations for the same statute ===');
await searchStatute(
  '9a. "42 U.S.C. § 1983"',
  '"42 U.S.C. § 1983"'
);
await searchStatute(
  '9b. "42 U.S.C. §1983" (no space after §)',
  '"42 U.S.C. §1983"'
);
await searchStatute(
  '9c. "42 USC § 1983" (no dots)',
  '"42 USC § 1983"'
);
await searchStatute(
  '9d. "section 1983 of title 42" (prose)',
  '"section 1983 of title 42"'
);

console.log('\nDone.');
