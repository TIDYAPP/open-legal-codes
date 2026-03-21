/**
 * Seed data for the trusted domains allowlist.
 * URLs from these domains are auto-approved when submitted as annotations.
 */

export interface TrustedDomainSeed {
  domain: string;
  sourceName: string;
  sourceType: 'law_firm' | 'government' | 'academic' | 'legal_publisher' | 'news' | 'other';
}

export const TRUSTED_DOMAINS: TrustedDomainSeed[] = [
  // --- Law firms (Am Law 20 + notable) ---
  { domain: 'lw.com', sourceName: 'Latham & Watkins', sourceType: 'law_firm' },
  { domain: 'kirkland.com', sourceName: 'Kirkland & Ellis', sourceType: 'law_firm' },
  { domain: 'skadden.com', sourceName: 'Skadden', sourceType: 'law_firm' },
  { domain: 'dlapiper.com', sourceName: 'DLA Piper', sourceType: 'law_firm' },
  { domain: 'jonesday.com', sourceName: 'Jones Day', sourceType: 'law_firm' },
  { domain: 'sidley.com', sourceName: 'Sidley Austin', sourceType: 'law_firm' },
  { domain: 'morganlewis.com', sourceName: 'Morgan Lewis', sourceType: 'law_firm' },
  { domain: 'whitecase.com', sourceName: 'White & Case', sourceType: 'law_firm' },
  { domain: 'gibsondunn.com', sourceName: 'Gibson Dunn', sourceType: 'law_firm' },
  { domain: 'cooley.com', sourceName: 'Cooley', sourceType: 'law_firm' },
  { domain: 'goodwinlaw.com', sourceName: 'Goodwin Procter', sourceType: 'law_firm' },
  { domain: 'wilmerhale.com', sourceName: 'WilmerHale', sourceType: 'law_firm' },
  { domain: 'winston.com', sourceName: 'Winston & Strawn', sourceType: 'law_firm' },
  { domain: 'orrick.com', sourceName: 'Orrick', sourceType: 'law_firm' },
  { domain: 'milbank.com', sourceName: 'Milbank', sourceType: 'law_firm' },
  { domain: 'debevoise.com', sourceName: 'Debevoise & Plimpton', sourceType: 'law_firm' },
  { domain: 'paulweiss.com', sourceName: 'Paul Weiss', sourceType: 'law_firm' },
  { domain: 'sullcrom.com', sourceName: 'Sullivan & Cromwell', sourceType: 'law_firm' },
  { domain: 'cravath.com', sourceName: 'Cravath', sourceType: 'law_firm' },
  { domain: 'bakermckenzie.com', sourceName: 'Baker McKenzie', sourceType: 'law_firm' },
  { domain: 'weil.com', sourceName: 'Weil Gotshal', sourceType: 'law_firm' },
  { domain: 'davispolk.com', sourceName: 'Davis Polk', sourceType: 'law_firm' },
  { domain: 'clearygottlieb.com', sourceName: 'Cleary Gottlieb', sourceType: 'law_firm' },
  { domain: 'simpsonthacher.com', sourceName: 'Simpson Thacher', sourceType: 'law_firm' },

  // --- Government (common .gov domains — .gov wildcard handled in code) ---
  { domain: 'justice.gov', sourceName: 'U.S. Department of Justice', sourceType: 'government' },
  { domain: 'ftc.gov', sourceName: 'Federal Trade Commission', sourceType: 'government' },
  { domain: 'sec.gov', sourceName: 'Securities and Exchange Commission', sourceType: 'government' },
  { domain: 'irs.gov', sourceName: 'Internal Revenue Service', sourceType: 'government' },
  { domain: 'supremecourt.gov', sourceName: 'U.S. Supreme Court', sourceType: 'government' },
  { domain: 'epa.gov', sourceName: 'Environmental Protection Agency', sourceType: 'government' },
  { domain: 'dol.gov', sourceName: 'Department of Labor', sourceType: 'government' },
  { domain: 'hhs.gov', sourceName: 'Department of Health and Human Services', sourceType: 'government' },
  { domain: 'uscourts.gov', sourceName: 'U.S. Courts', sourceType: 'government' },

  // --- Academic ---
  { domain: 'law.harvard.edu', sourceName: 'Harvard Law School', sourceType: 'academic' },
  { domain: 'law.stanford.edu', sourceName: 'Stanford Law School', sourceType: 'academic' },
  { domain: 'law.yale.edu', sourceName: 'Yale Law School', sourceType: 'academic' },
  { domain: 'law.cornell.edu', sourceName: 'Cornell Law (LII)', sourceType: 'academic' },
  { domain: 'ssrn.com', sourceName: 'SSRN', sourceType: 'academic' },
  { domain: 'scholarship.law.columbia.edu', sourceName: 'Columbia Law School', sourceType: 'academic' },
  { domain: 'chicagounbound.uchicago.edu', sourceName: 'U. of Chicago Law', sourceType: 'academic' },

  // --- Legal publishers ---
  { domain: 'law.justia.com', sourceName: 'Justia', sourceType: 'legal_publisher' },
  { domain: 'findlaw.com', sourceName: 'FindLaw', sourceType: 'legal_publisher' },
  { domain: 'nolo.com', sourceName: 'Nolo', sourceType: 'legal_publisher' },
  { domain: 'casetext.com', sourceName: 'Casetext', sourceType: 'legal_publisher' },
  { domain: 'courtlistener.com', sourceName: 'CourtListener (Free Law Project)', sourceType: 'legal_publisher' },

  // --- News / analysis ---
  { domain: 'law.com', sourceName: 'Law.com', sourceType: 'news' },
  { domain: 'bloomberglaw.com', sourceName: 'Bloomberg Law', sourceType: 'news' },
  { domain: 'reuters.com', sourceName: 'Reuters', sourceType: 'news' },
];
