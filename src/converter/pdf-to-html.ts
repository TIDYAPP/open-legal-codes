import { PDFParse } from 'pdf-parse';

export interface PdfSection {
  id: string;
  title: string;
  html: string;
}

/**
 * Extract text from a PDF buffer and split into sections.
 * Detects section headings by pattern: uppercase letter followed by period and title
 * (e.g., "A. General Regulations", "B. Exterior/Common Elements").
 */
export async function parsePdf(data: Buffer): Promise<{
  title: string;
  sections: PdfSection[];
  fullText: string;
}> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  const result = await parser.getText();

  // Combine all pages, removing page markers
  const fullText = result.text
    .replace(/-- \d+ of \d+ --/g, '')
    .replace(/\d+ \| P a g e/g, '')
    .trim();

  // Extract title from first page
  const titleMatch = fullText.match(/^(.+?)(?:\n|Date Effective)/s);
  const title = titleMatch
    ? titleMatch[1].replace(/\n/g, ' ').trim()
    : 'Untitled Document';

  // Strip the TABLE OF CONTENTS block to avoid duplicate matches
  // TOC entries are ALL CAPS with tab + page numbers (e.g., "A. GENERAL REGULATIONS \t2")
  const tocEnd = fullText.search(/\bIntroduction\b/i);
  const contentText = tocEnd >= 0 ? fullText.substring(tocEnd) : fullText;

  // Split into sections by detecting uppercase letter + period headings
  // Pattern: line starting with a capital letter, period, space, then mixed-case title
  // Exclude all-caps TOC entries (which have tab + page numbers at the end)
  const sectionRegex = /^([A-Z])\.\s+(.+)$/gm;
  const matches: Array<{ letter: string; title: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(contentText)) !== null) {
    const matchTitle = match[2].trim();
    // Skip TOC entries: all uppercase or ending with tab+digits (page numbers)
    if (/\t\d/.test(matchTitle) || matchTitle === matchTitle.toUpperCase()) continue;
    matches.push({
      letter: match[1],
      title: matchTitle,
      index: match.index,
    });
  }

  const sections: PdfSection[] = [];

  if (matches.length === 0) {
    // No sections detected — treat the whole document as one section
    sections.push({
      id: 'full-document',
      title,
      html: textToHtml(contentText),
    });
  } else {
    // Add introduction if there's content before the first section
    const introText = contentText.substring(0, matches[0].index).trim();
    // Strip "Introduction" heading itself
    const introBody = introText.replace(/^Introduction\s*/i, '').trim();
    if (introBody.length > 50) {
      sections.push({
        id: 'introduction',
        title: 'Introduction',
        html: textToHtml(introBody),
      });
    }

    // Extract each section
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : contentText.length;
      const sectionText = contentText.substring(start, end).trim();

      // Remove the heading line from the body text
      const bodyStart = sectionText.indexOf('\n');
      const body = bodyStart >= 0 ? sectionText.substring(bodyStart).trim() : '';

      const slug = matches[i].title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      sections.push({
        id: slug,
        title: `${matches[i].letter}. ${matches[i].title}`,
        html: textToHtml(body),
      });
    }
  }

  await parser.destroy();

  return { title, sections, fullText };
}

/**
 * Convert plain text to simple HTML with paragraphs.
 * Detects numbered items (1., 2., etc.) and wraps them as list items.
 */
function textToHtml(text: string): string {
  const lines = text.split('\n');
  const parts: string[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const joined = currentParagraph.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) {
        parts.push(`<p>${escapeHtml(joined)}</p>`);
      }
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Detect numbered items (start new paragraph)
    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
    }

    currentParagraph.push(trimmed);
  }

  flushParagraph();
  return parts.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
