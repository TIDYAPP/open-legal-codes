/**
 * USLM Identifier Generation
 *
 * Generates @identifier and @temporalId attributes for USLM XML elements.
 *
 * @identifier: hierarchical path like "/ca-palm-desert/title-5/chapter-5.10/section-5.10.010"
 * @temporalId: underscore-separated like "s5_10_010"
 */

/** Generate a USLM @identifier from jurisdiction ID and code path */
export function makeIdentifier(jurisdictionId: string, codePath: string): string {
  return `/${jurisdictionId}/${codePath}`;
}

/** Generate a USLM @temporalId from a section number */
export function makeTemporalId(sectionNum: string): string {
  // "5.10.010" → "s5_10_010"
  const normalized = sectionNum.replace(/\./g, '_');
  return `s${normalized}`;
}

/** Generate a URL-safe slug from a level label and number */
export function makeSlug(level: string, num: string): string {
  // "Chapter 5.10" → "chapter-5.10"
  // "Title 5" → "title-5"
  // "PART I" → "part-i"
  const cleanNum = num
    .replace(/^(Title|Subtitle|Chapter|Subchapter|Article|Subarticle|Division|Subdivision|Part|Subpart|Section)\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${level.toLowerCase()}-${cleanNum || 'untitled'}`;
}
