#!/usr/bin/env npx tsx
/**
 * Prototype: Test eyecite-ts integration with CourtListener.
 *
 * Flow:
 * 1. Pick a well-known statute (42 U.S.C. § 1983)
 * 2. Search CourtListener for opinions citing it
 * 3. Fetch full opinion text from CourtListener
 * 4. Run eyecite-ts to extract all statute citations from the opinion
 * 5. Show what statutes this opinion references
 *
 * Usage: COURTLISTENER_API_TOKEN=xxx npx tsx scripts/test-eyecite.ts
 */

import { extractCitations } from 'eyecite-ts';

const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';

const token = process.env.COURTLISTENER_API_TOKEN;
if (!token) {
  console.error('Set COURTLISTENER_API_TOKEN env var');
  process.exit(1);
}

const headers: Record<string, string> = {
  Authorization: `Token ${token}`,
  'User-Agent': 'OpenLegalCodes/0.1 (open-source legal code archive)',
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}\n${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// Step 1: Search for opinions citing 42 U.S.C. § 1983
console.log('=== Step 1: Search CourtListener for "42 U.S.C. § 1983" ===\n');

const searchUrl = `${COURTLISTENER_BASE}/search/?` + new URLSearchParams({
  q: '"42 U.S.C. § 1983"',
  type: 'o',
  order_by: 'dateFiled desc',
  page_size: '3',
}).toString();

const searchResults = await fetchJson<any>(searchUrl);
console.log(`Found ${searchResults.count} total opinions citing 42 U.S.C. § 1983`);
console.log(`Showing first ${searchResults.results.length}:\n`);

for (const r of searchResults.results) {
  console.log(`  ${r.caseName} (${r.court}, ${r.dateFiled})`);
  console.log(`  ${r.citation?.join(', ') || 'no citation'}`);
  console.log(`  https://www.courtlistener.com${r.absoluteUrl}`);
  console.log();
}

// Step 2: Pick the first opinion and fetch its full text
const firstResult = searchResults.results[0];
if (!firstResult) {
  console.log('No results found.');
  process.exit(0);
}

console.log(`=== Step 2: Fetch full opinion text for "${firstResult.caseName}" ===\n`);

// The search result has opinions array with IDs
// We need to fetch the opinion text from the opinions endpoint
const clusterId = firstResult.cluster_id;

// Fetch the cluster to get opinion IDs
const clusterUrl = `${COURTLISTENER_BASE}/clusters/${clusterId}/?format=json`;
const cluster = await fetchJson<any>(clusterUrl);

console.log(`Cluster ${clusterId}: ${cluster.case_name}`);
console.log(`Sub-opinions: ${cluster.sub_opinions?.length || 'unknown'}`);

// Fetch the first sub-opinion to get full text
let opinionText = '';
if (cluster.sub_opinions && cluster.sub_opinions.length > 0) {
  // sub_opinions is an array of URLs like "https://www.courtlistener.com/api/rest/v4/opinions/12345/"
  // sub_opinions URLs may already have format param; strip trailing slash and add format
  const rawUrl = cluster.sub_opinions[0].replace(/\/$/, '');
  const opinionUrl = rawUrl.includes('?') ? rawUrl : rawUrl + '?format=json';
  const opinion = await fetchJson<any>(opinionUrl);

  // Opinion text can be in several fields
  opinionText = opinion.plain_text || opinion.html || opinion.html_lawbox || opinion.html_columbia || '';

  console.log(`Opinion type: ${opinion.type}`);
  console.log(`Text length: ${opinionText.length} chars`);
  console.log(`Text fields available: ${['plain_text', 'html', 'html_lawbox', 'html_columbia', 'html_with_citations', 'xml_harvard'].filter(f => opinion[f]).join(', ')}`);
} else {
  console.log('No sub-opinions found, trying opinions endpoint...');
  // Try fetching opinions for this cluster
  const opinionsUrl = `${COURTLISTENER_BASE}/opinions/?cluster_id=${clusterId}&format=json`;
  const opinions = await fetchJson<any>(opinionsUrl);
  if (opinions.results?.length > 0) {
    const opinion = opinions.results[0];
    opinionText = opinion.plain_text || opinion.html || opinion.html_lawbox || '';
    console.log(`Found ${opinions.results.length} opinions`);
    console.log(`Text length: ${opinionText.length} chars`);
  }
}

if (!opinionText) {
  console.log('\nNo opinion text available. CourtListener may require auth for full text.');
  process.exit(0);
}

// Step 3: Run eyecite-ts on the opinion text
console.log(`\n=== Step 3: Extract citations with eyecite-ts ===\n`);

// Strip HTML if needed
const plainText = opinionText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log(`Processing ${plainText.length} chars of opinion text...\n`);

const citations = extractCitations(plainText);

console.log(`Found ${citations.length} total citations:\n`);

// Group by type
const byType: Record<string, any[]> = {};
for (const c of citations) {
  if (!byType[c.type]) byType[c.type] = [];
  byType[c.type].push(c);
}

for (const [type, cites] of Object.entries(byType)) {
  console.log(`  ${type}: ${cites.length}`);
}

// Show statute citations in detail
console.log('\n--- Statute Citations ---\n');
const statutes = citations.filter(c => c.type === 'statute');
if (statutes.length === 0) {
  console.log('  (none found)');
} else {
  for (const s of statutes) {
    if (s.type === 'statute') {
      console.log(`  ${s.matchedText}`);
      console.log(`    code: ${s.code}, section: ${s.section}, title: ${s.title || 'N/A'}, jurisdiction: ${s.jurisdiction || 'N/A'}`);
      if (s.subsection) console.log(`    subsection: ${s.subsection}`);
      console.log();
    }
  }
}

// Show case citations too for context
console.log('--- Case Citations (first 10) ---\n');
const cases = citations.filter(c => c.type === 'case').slice(0, 10);
for (const c of cases) {
  if (c.type === 'case') {
    console.log(`  ${c.matchedText} — ${c.caseName || ''}`);
  }
}

// Step 4: Show which of these statutes we could link to in Open Legal Codes
console.log('\n=== Step 4: Statutes that could map to Open Legal Codes ===\n');

for (const s of statutes) {
  if (s.type !== 'statute') continue;

  let olcPath = '';
  if (s.code === 'U.S.C.' && s.title) {
    olcPath = `us-usc-title-${s.title} → section-${s.section}`;
  } else if (s.code === 'C.F.R.' && s.title) {
    olcPath = `us-ecfr-title-${s.title} → section-${s.section}`;
  } else if (s.jurisdiction === 'CA') {
    olcPath = `ca-gov (or similar) → section-${s.section}`;
  } else if (s.jurisdiction) {
    olcPath = `${s.jurisdiction.toLowerCase()}-statutes → section-${s.section}`;
  } else {
    olcPath = `(unmapped) ${s.code} § ${s.section}`;
  }

  console.log(`  ${s.matchedText}  →  ${olcPath}`);
}

console.log('\nDone.');
