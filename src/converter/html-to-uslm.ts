import * as cheerio from 'cheerio';
import { makeIdentifier, makeTemporalId } from './identifiers.js';

export interface ConvertOptions {
  jurisdictionId: string;
  /** Parent path, e.g. "part-i/chapter-1" */
  parentPath: string;
  sectionNum: string;
  heading: string;
}

/**
 * Convert Municode HTML content to simplified USLM XML.
 *
 * MVP approach: extract text paragraphs, wrap in USLM structure.
 * Does not attempt to parse subsection numbering (a), (1), etc. yet.
 */
export function htmlToUslm(html: string, options: ConvertOptions): string {
  const $ = cheerio.load(html);

  // Extract text paragraphs from chunk-content divs
  const paragraphs: string[] = [];
  $('p, .p0, .p1, .p2, .p3').each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      paragraphs.push(text);
    }
  });

  // If no paragraphs found, try getting all text content
  if (paragraphs.length === 0) {
    const text = $.text().trim();
    if (text) {
      paragraphs.push(text);
    }
  }

  const codePath = options.parentPath
    ? `${options.parentPath}/${makeSlugFromNum(options.sectionNum)}`
    : makeSlugFromNum(options.sectionNum);

  const identifier = makeIdentifier(options.jurisdictionId, codePath);
  const temporalId = makeTemporalId(options.sectionNum);

  const contentXml = paragraphs
    .map(p => `        <p>${escapeXml(p)}</p>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<lawDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"
        identifier="${escapeXml(identifier)}">
  <meta>
    <dc:title>${escapeXml(options.heading)}</dc:title>
  </meta>
  <main>
    <section identifier="${escapeXml(identifier)}"
             temporalId="${escapeXml(temporalId)}">
      <num>${escapeXml(options.sectionNum)}</num>
      <heading>${escapeXml(options.heading)}</heading>
      <content>
${contentXml}
      </content>
    </section>
  </main>
</lawDoc>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeSlugFromNum(num: string): string {
  const cleaned = num.replace(/\.$/, '').trim();
  if (/^section\s/i.test(cleaned)) {
    return cleaned.toLowerCase().replace(/\s+/g, '-');
  }
  return `section-${cleaned.toLowerCase().replace(/\s+/g, '-')}`;
}
