/**
 * Maps Open Legal Codes jurisdictions + paths to Bluebook citation strings
 * for searching CourtListener.
 *
 * Each publisher type has standardized citation formats that courts use
 * when referring to statutes. This module knows those formats and generates
 * the appropriate search queries.
 */

import type { Jurisdiction, TocNode } from '../types.js';
import type { CitationQuery } from './types.js';

/**
 * Build CourtListener search queries for a given code section.
 *
 * Returns an empty array for jurisdiction types where citation formats
 * are not standardized (e.g., municipal codes).
 */
export function buildCitationQueries(
  jurisdiction: Jurisdiction,
  codePath: string,
  tocNode?: TocNode,
): CitationQuery[] {
  const publisher = jurisdiction.publisher.name;
  const sourceId = jurisdiction.publisher.sourceId;

  switch (publisher) {
    case 'usc':
      return buildUscQueries(jurisdiction.id, codePath, tocNode);
    case 'ecfr':
      return buildCfrQueries(jurisdiction.id, codePath, tocNode);
    case 'ca-leginfo':
      return buildCaliforniaQueries(sourceId, codePath, tocNode);
    case 'ny-openleg':
      return buildNewYorkQueries(jurisdiction.id, codePath, tocNode);

    default: {
      // Check state statute lookup table
      const stateEntry = STATE_STATUTE_BLUEBOOK[publisher];
      if (stateEntry) {
        return buildStateQueries(stateEntry.abbrev, jurisdiction.id, codePath, tocNode,
          stateEntry.statFormat ? { useStatFormat: true } : undefined);
      }
      // Municipal codes and unknown publishers — no standardized citation format
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// State statute Bluebook abbreviation table
// ---------------------------------------------------------------------------

const STATE_STATUTE_BLUEBOOK: Record<string, { abbrev: string; statFormat?: boolean }> = {
  'tx-statutes': { abbrev: 'Tex.' },
  'fl-statutes': { abbrev: 'Fla. Stat.', statFormat: true },
  'nc-statutes': { abbrev: 'N.C. Gen. Stat.', statFormat: true },
  'va-statutes': { abbrev: 'Va. Code Ann.', statFormat: true },
  'wa-statutes': { abbrev: 'Wash. Rev. Code', statFormat: true },
  'oh-statutes': { abbrev: 'Ohio Rev. Code', statFormat: true },
  'ma-statutes': { abbrev: 'Mass. Gen. Laws', statFormat: true },
  'il-statutes': { abbrev: '735 Ill. Comp. Stat.', statFormat: true },
  'pa-statutes': { abbrev: 'Pa. Stat.', statFormat: true },
  'nj-statutes': { abbrev: 'N.J. Stat. Ann.', statFormat: true },
  'ga-statutes': { abbrev: 'Ga. Code Ann.', statFormat: true },
  'co-statutes': { abbrev: 'Colo. Rev. Stat.', statFormat: true },
  'az-statutes': { abbrev: 'Ariz. Rev. Stat.', statFormat: true },
  'tn-statutes': { abbrev: 'Tenn. Code Ann.', statFormat: true },
};

// ---------------------------------------------------------------------------
// Federal: USC
// ---------------------------------------------------------------------------

function buildUscQueries(
  jurisdictionId: string,
  codePath: string,
  tocNode?: TocNode,
): CitationQuery[] {
  // jurisdiction ID like "us-usc-title-42"
  const titleMatch = jurisdictionId.match(/title-(\d+)/);
  if (!titleMatch) return [];
  const title = titleMatch[1];

  const section = extractSectionNumber(codePath, tocNode);
  if (!section) return [];

  return [
    { query: `"${title} U.S.C. § ${section}"`, label: `${title} U.S.C. § ${section}` },
    { query: `"${title} USC § ${section}"`, label: `${title} USC § ${section}` },
    { query: `"${title} U.S.C. ${section}"`, label: `${title} U.S.C. ${section}` },
  ];
}

// ---------------------------------------------------------------------------
// Federal: CFR
// ---------------------------------------------------------------------------

function buildCfrQueries(
  jurisdictionId: string,
  codePath: string,
  tocNode?: TocNode,
): CitationQuery[] {
  const titleMatch = jurisdictionId.match(/title-(\d+)/);
  if (!titleMatch) return [];
  const title = titleMatch[1];

  const section = extractSectionNumber(codePath, tocNode);
  if (!section) return [];

  return [
    { query: `"${title} C.F.R. § ${section}"`, label: `${title} C.F.R. § ${section}` },
    { query: `"${title} CFR § ${section}"`, label: `${title} CFR § ${section}` },
  ];
}

// ---------------------------------------------------------------------------
// California
// ---------------------------------------------------------------------------

const CA_CODE_BLUEBOOK: Record<string, string> = {
  BPC: 'Bus. & Prof.',
  CIV: 'Civ.',
  CCP: 'Civ. Proc.',
  COM: 'Com.',
  CONS: 'Const.',
  CORP: 'Corp.',
  EDC: 'Educ.',
  ELEC: 'Elec.',
  EVID: 'Evid.',
  FAM: 'Fam.',
  FIN: 'Fin.',
  FGC: 'Fish & Game',
  FAC: 'Food & Agric.',
  GOV: 'Gov.',
  HNC: 'Harb. & Nav.',
  HSC: 'Health & Safety',
  INS: 'Ins.',
  LAB: 'Lab.',
  MVC: 'Mil. & Vet.',
  PEN: 'Pen.',
  PROB: 'Prob.',
  PCC: 'Pub. Contract',
  PRC: 'Pub. Res.',
  PUC: 'Pub. Util.',
  RTC: 'Rev. & Tax.',
  SHC: 'Sts. & High.',
  UIC: 'Unemp. Ins.',
  VEH: 'Veh.',
  WAT: 'Water',
  WIC: 'Welf. & Inst.',
};

// Full code names used by courts in long-form citations (e.g., "Penal Code section 187")
const CA_CODE_FULL_NAME: Record<string, string> = {
  BPC: 'Business and Professions',
  CIV: 'Civil',
  CCP: 'Code of Civil Procedure',
  COM: 'Commercial',
  CORP: 'Corporations',
  EDC: 'Education',
  ELEC: 'Elections',
  EVID: 'Evidence',
  FAM: 'Family',
  FIN: 'Financial',
  FGC: 'Fish and Game',
  FAC: 'Food and Agricultural',
  GOV: 'Government',
  HNC: 'Harbors and Navigation',
  HSC: 'Health and Safety',
  INS: 'Insurance',
  LAB: 'Labor',
  MVC: 'Military and Veterans',
  PEN: 'Penal',
  PROB: 'Probate',
  PCC: 'Public Contract',
  PRC: 'Public Resources',
  PUC: 'Public Utilities',
  RTC: 'Revenue and Taxation',
  SHC: 'Streets and Highways',
  UIC: 'Unemployment Insurance',
  VEH: 'Vehicle',
  WAT: 'Water',
  WIC: 'Welfare and Institutions',
};

function buildCaliforniaQueries(
  sourceId: string, // e.g., "GOV"
  codePath: string,
  tocNode?: TocNode,
): CitationQuery[] {
  const abbrev = CA_CODE_BLUEBOOK[sourceId.toUpperCase()];
  if (!abbrev) return [];

  const section = extractSectionNumber(codePath, tocNode);
  if (!section) return [];

  const queries: CitationQuery[] = [
    { query: `"Cal. ${abbrev} Code § ${section}"`, label: `Cal. ${abbrev} Code § ${section}` },
    { query: `"California ${abbrev} Code § ${section}"`, label: `California ${abbrev} Code § ${section}` },
  ];

  // Add long-form variant courts often use (e.g., "Penal Code section 12022.53")
  const fullName = CA_CODE_FULL_NAME[sourceId.toUpperCase()];
  if (fullName) {
    queries.push({
      query: `"${fullName} Code section ${section}"`,
      label: `${fullName} Code section ${section}`,
    });
  }

  return queries;
}

// ---------------------------------------------------------------------------
// New York
// ---------------------------------------------------------------------------

const NY_LAW_BLUEBOOK: Record<string, string> = {
  'ny-abandonment-of-property': 'Aband. Prop.',
  'ny-agriculture-and-markets': 'Agric. & Mkts.',
  'ny-alcoholic-beverage-control': 'Alco. Bev. Ctrl.',
  'ny-alternative-county-government': 'Alt. County Gov\'t',
  'ny-arts-and-cultural-affairs': 'Arts & Cult. Aff.',
  'ny-banking': 'Banking',
  'ny-benevolent-orders': 'Benev. Orders',
  'ny-business-corporation': 'Bus. Corp.',
  'ny-canal': 'Canal',
  'ny-civil-practice-law-and-rules': 'C.P.L.R.',
  'ny-civil-rights': 'Civ. Rights',
  'ny-civil-service': 'Civ. Serv.',
  'ny-cooperative-corporations': 'Coop. Corp.',
  'ny-correction': 'Correct.',
  'ny-county': 'County',
  'ny-criminal-procedure': 'Crim. Proc.',
  'ny-debtor-and-creditor': 'Debt. & Cred.',
  'ny-domestic-relations': 'Dom. Rel.',
  'ny-economic-development-law': 'Econ. Dev.',
  'ny-education': 'Educ.',
  'ny-election': 'Elec.',
  'ny-eminent-domain-procedure': 'Em. Dom. Proc.',
  'ny-energy': 'Energy',
  'ny-environmental-conservation': 'Envtl. Conserv.',
  'ny-estates-powers-and-trusts': 'Est. Powers & Trusts',
  'ny-executive': 'Exec.',
  'ny-family-court-act': 'Fam. Ct. Act',
  'ny-financial-services': 'Fin. Servs.',
  'ny-general-associations': 'Gen. Assocs.',
  'ny-general-business': 'Gen. Bus.',
  'ny-general-city': 'Gen. City',
  'ny-general-construction': 'Gen. Constr.',
  'ny-general-municipal': 'Gen. Mun.',
  'ny-general-obligations': 'Gen. Oblig.',
  'ny-highway': 'High.',
  'ny-indian': 'Indian',
  'ny-insurance': 'Ins.',
  'ny-judiciary': 'Jud.',
  'ny-labor': 'Lab.',
  'ny-legislative': 'Legis.',
  'ny-lien': 'Lien',
  'ny-limited-liability-company': 'Ltd. Liab. Co.',
  'ny-local-finance': 'Loc. Fin.',
  'ny-mental-hygiene': 'Mental Hyg.',
  'ny-military': 'Mil.',
  'ny-multiple-dwelling': 'Mult. Dwell.',
  'ny-multiple-residence': 'Mult. Res.',
  'ny-municipal-home-rule': 'Mun. Home Rule',
  'ny-navigation': 'Nav.',
  'ny-not-for-profit-corporation': 'Not-for-Profit Corp.',
  'ny-parks-recreation-and-historic-preservation': 'Parks Rec. & Hist. Preserv.',
  'ny-partnership': 'P\'ship',
  'ny-penal': 'Penal',
  'ny-personal-property': 'Pers. Prop.',
  'ny-private-housing-finance': 'Priv. Hous. Fin.',
  'ny-public-authorities': 'Pub. Auth.',
  'ny-public-buildings': 'Pub. Bldgs.',
  'ny-public-health': 'Pub. Health',
  'ny-public-housing': 'Pub. Hous.',
  'ny-public-lands': 'Pub. Lands',
  'ny-public-officers': 'Pub. Off.',
  'ny-public-service': 'Pub. Serv.',
  'ny-racing-pari-mutuel-wagering-and-breeding': 'Racing Pari-Mutuel',
  'ny-railroad': 'R.R.',
  'ny-real-property': 'Real Prop.',
  'ny-real-property-actions-and-proceedings': 'Real Prop. Acts.',
  'ny-real-property-tax': 'Real Prop. Tax',
  'ny-religious-corporations': 'Relig. Corp.',
  'ny-retirement-and-social-security': 'Retire. & Soc. Sec.',
  'ny-rural-electric-cooperative': 'Rural Elec. Coop.',
  'ny-second-class-cities': 'Second Class Cities',
  'ny-social-services': 'Soc. Servs.',
  'ny-soil-and-water-conservation-districts': 'Soil & Water Conserv. Dist.',
  'ny-state-administrative-procedure-act': 'State Admin. Proc. Act',
  'ny-state-finance': 'State Fin.',
  'ny-state-technology': 'State Tech.',
  'ny-statute-of-local-governments': 'Stat. Local Gov\'ts',
  'ny-surrogate-s-court-procedure-act': 'Sur. Ct. Proc. Act',
  'ny-tax': 'Tax',
  'ny-town': 'Town',
  'ny-transportation': 'Transp.',
  'ny-transportation-corporations': 'Transp. Corp.',
  'ny-uniform-commercial-code': 'U.C.C.',
  'ny-vehicle-and-traffic': 'Veh. & Traf.',
  'ny-village': 'Village',
  'ny-volunteer-ambulance-workers-benefit': 'Vol. Amb. Workers\' Ben.',
  'ny-volunteer-firefighters-benefit': 'Vol. Fire. Ben.',
  'ny-workers-compensation': 'Workers\' Comp.',
};

function buildNewYorkQueries(
  jurisdictionId: string,
  codePath: string,
  tocNode?: TocNode,
): CitationQuery[] {
  const abbrev = NY_LAW_BLUEBOOK[jurisdictionId];
  if (!abbrev) return [];

  const section = extractSectionNumber(codePath, tocNode);
  if (!section) return [];

  return [
    { query: `"N.Y. ${abbrev} Law § ${section}"`, label: `N.Y. ${abbrev} Law § ${section}` },
  ];
}

// ---------------------------------------------------------------------------
// Generic state statutes
// ---------------------------------------------------------------------------

interface StateOptions {
  /** If true, use "abbrev § section" format (most states). If false, use "abbrev code § section" */
  useStatFormat?: boolean;
}

function buildStateQueries(
  stateAbbrev: string,
  jurisdictionId: string,
  codePath: string,
  tocNode?: TocNode,
  options?: StateOptions,
): CitationQuery[] {
  const section = extractSectionNumber(codePath, tocNode);
  if (!section) return [];

  if (options?.useStatFormat) {
    // Format: "Fla. Stat. § 718.111"
    return [
      { query: `"${stateAbbrev} § ${section}"`, label: `${stateAbbrev} § ${section}` },
    ];
  }

  // Texas-style: extract code name from jurisdiction ID
  // e.g., "tx-property-code" → "Prop."
  const codeMatch = jurisdictionId.match(/^[a-z]{2}-(.+)-code$/);
  if (!codeMatch) {
    return [
      { query: `"${stateAbbrev} § ${section}"`, label: `${stateAbbrev} § ${section}` },
    ];
  }

  const codeName = codeMatch[1];
  const txAbbrev = TX_CODE_BLUEBOOK[codeName];
  if (!txAbbrev) {
    return [
      { query: `"${stateAbbrev} § ${section}"`, label: `${stateAbbrev} § ${section}` },
    ];
  }

  return [
    { query: `"${stateAbbrev} ${txAbbrev} Code § ${section}"`, label: `${stateAbbrev} ${txAbbrev} Code § ${section}` },
  ];
}

const TX_CODE_BLUEBOOK: Record<string, string> = {
  'agriculture': 'Agric.',
  'alcoholic-beverage': 'Alco. Bev.',
  'business-and-commerce': 'Bus. & Com.',
  'business-organizations': 'Bus. Orgs.',
  'civil-practice-and-remedies': 'Civ. Prac. & Rem.',
  'education': 'Educ.',
  'election': 'Elec.',
  'estates': 'Est.',
  'family': 'Fam.',
  'finance': 'Fin.',
  'government': 'Gov\'t',
  'health-and-safety': 'Health & Safety',
  'human-resources': 'Hum. Res.',
  'insurance': 'Ins.',
  'labor': 'Lab.',
  'local-government': 'Loc. Gov\'t',
  'natural-resources': 'Nat. Res.',
  'occupations': 'Occ.',
  'parks-and-wildlife': 'Parks & Wild.',
  'penal': 'Penal',
  'property': 'Prop.',
  'special-district-local-laws': 'Spec. Dist.',
  'tax': 'Tax',
  'transportation': 'Transp.',
  'utilities': 'Util.',
  'water': 'Water',
};

// ---------------------------------------------------------------------------
// Section number extraction
// ---------------------------------------------------------------------------

/**
 * Extract the section number from a code path or TOC node.
 *
 * Tries multiple strategies:
 * 1. Last path segment matching "section-{num}" → extract {num}
 * 2. TOC node num field → extract numeric portion
 */
export function extractSectionNumber(
  codePath: string,
  tocNode?: TocNode,
): string | null {
  // Strategy 1: Parse from path
  const segments = codePath.split('/');
  const lastSegment = segments[segments.length - 1];

  // Match "section-123", "section-12.45", "section-12-345"
  const pathMatch = lastSegment.match(/^section-(.+)$/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Strategy 2: Parse from TOC node num
  if (tocNode?.num) {
    // "Section 12965" → "12965"
    // "§ 1983" → "1983"
    const numMatch = tocNode.num.match(/(?:Section|§|Sec\.?)\s*(.+)/i);
    if (numMatch) {
      return numMatch[1].trim();
    }

    // Bare number
    if (/^[\d.]+$/.test(tocNode.num.trim())) {
      return tocNode.num.trim();
    }
  }

  return null;
}
