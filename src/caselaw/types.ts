export interface CaseLawResult {
  clusterId: number;
  caseName: string;
  court: string;
  dateFiled: string;
  url: string;
  snippet: string;
  citation: string;
  citeCount: number;
}

export interface CitationQuery {
  /** CourtListener search string, e.g. '"42 U.S.C. § 1983"' */
  query: string;
  /** Human-readable label, e.g. '42 U.S.C. § 1983' */
  label: string;
}

export interface CaseLawPage {
  results: CaseLawResult[];
  totalCount: number;
  queries: CitationQuery[];
  supported: boolean;
  fromCache: boolean;
}
