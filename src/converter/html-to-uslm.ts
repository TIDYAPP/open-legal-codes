/**
 * HTML → USLM XML Converter
 *
 * Transforms raw HTML from publisher sites into USLM XML format.
 *
 * Pipeline:
 * 1. Parse HTML with Cheerio
 * 2. Detect structure via numbering patterns:
 *    - Section numbers: 5.10.010, 5.10.020
 *    - Subsection letters: (a), (b), (c)
 *    - Paragraph numbers: (1), (2), (3)
 *    - Subparagraph letters: (A), (B), (C)
 * 3. Map to USLM elements with correct nesting
 * 4. Generate @identifier paths and @temporalId values
 * 5. Emit USLM XML string
 *
 * TODO: Implement
 */

export interface ConvertOptions {
  jurisdictionId: string;
  parentPath: string;
  sectionNum: string;
  heading: string;
}

export function htmlToUslm(_html: string, _options: ConvertOptions): string {
  // TODO: Implement conversion
  throw new Error('Not implemented');
}
