// ---------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------

export type JurisdictionType = 'federal' | 'state' | 'county' | 'city';

export interface PublisherInfo {
  name: 'municode' | 'amlegal';
  /** Publisher's internal ID for this code (e.g., Municode clientId) */
  sourceId: string;
  /** Canonical URL on publisher site */
  url: string;
}

export interface Jurisdiction {
  /** URL-safe slug: "ca-palm-desert", "ca", "us" */
  id: string;
  /** Display name: "Palm Desert, CA" */
  name: string;
  type: JurisdictionType;
  /** Two-letter state code, null for federal */
  state: string | null;
  /** Parent jurisdiction id (city → state → federal) */
  parentId: string | null;
  /** FIPS code if available */
  fips: string | null;
  publisher: PublisherInfo;
  /** ISO timestamp of last successful crawl */
  lastCrawled: string;
  /** ISO timestamp of last detected content change */
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Table of Contents
// ---------------------------------------------------------------------------

export type TocLevel =
  | 'title'
  | 'subtitle'
  | 'chapter'
  | 'subchapter'
  | 'article'
  | 'subarticle'
  | 'division'
  | 'subdivision'
  | 'part'
  | 'subpart'
  | 'section';

export interface TocNode {
  /** Path segment within the jurisdiction: "chapter-5.10" */
  slug: string;
  /** Full path from jurisdiction root: "title-5/chapter-5.10" */
  path: string;
  /** USLM level type */
  level: TocLevel;
  /** Display number: "Chapter 5.10" */
  num: string;
  /** Display heading: "Short-Term Rental Regulations" */
  heading: string;
  /** Whether this node has retrievable content (sections do; chapters may be containers) */
  hasContent: boolean;
  /** Publisher's internal node ID — used during crawl */
  sourceNodeId?: string;
  /** Children in the hierarchy */
  children?: TocNode[];
}

export interface TocTree {
  jurisdiction: string;
  title: string;
  children: TocNode[];
}

// ---------------------------------------------------------------------------
// Code Content
// ---------------------------------------------------------------------------

export type ContentNodeType =
  | 'subsection'
  | 'paragraph'
  | 'subparagraph'
  | 'clause'
  | 'subclause'
  | 'item'
  | 'text'
  | 'chapeau'
  | 'continuation'
  | 'def'
  | 'table';

export interface ContentNode {
  type: ContentNodeType;
  num?: string;
  heading?: string;
  text?: string;
  children?: ContentNode[];
}

export interface CodeContent {
  jurisdiction: string;
  path: string;
  level: string;
  num: string;
  heading: string;
  /** USLM XML string (when format=xml) */
  xml?: string;
  /** Parsed JSON structure (when format=json) */
  content?: ContentNode[];
  /** ISO timestamp */
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// API Response Envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  meta: {
    version: string;
    timestamp: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Crawler Types
// ---------------------------------------------------------------------------

export interface RawTocNode {
  /** Publisher's internal node ID */
  id: string;
  /** Display title (e.g., "Chapter 5.10 - Short-Term Rentals") */
  title: string;
  /** Publisher's level label */
  level: string;
  hasContent: boolean;
  children: RawTocNode[];
}

export interface RawContent {
  html: string;
  fetchedAt: string;
  sourceUrl: string;
}

export interface CrawlerAdapter {
  readonly publisherName: 'municode' | 'amlegal';
  /** Discover all available jurisdictions from this publisher */
  listJurisdictions(state?: string): AsyncIterable<Jurisdiction>;
  /** Fetch the table of contents tree for a jurisdiction */
  fetchToc(sourceId: string): Promise<RawTocNode[]>;
  /** Fetch the raw HTML content of a single section */
  fetchSection(sourceId: string, sectionId: string): Promise<RawContent>;
}
