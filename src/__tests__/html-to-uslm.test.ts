import { describe, it, expect } from 'vitest';
import { htmlToUslm } from '../converter/html-to-uslm.js';

describe('htmlToUslm', () => {
  it('converts basic HTML to USLM XML', () => {
    const html = `
      <div class="chunk-title">Section 100. - Name.</div>
      <div class="chunk-content">
        <p class="p0">The City of Test shall be known as Test City.</p>
      </div>
    `;

    const xml = htmlToUslm(html, {
      jurisdictionId: 'test-city',
      parentPath: 'chapter-1',
      sectionNum: 'Section 100',
      heading: 'Name',
    });

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('lawDoc');
    expect(xml).toContain('identifier="/test-city/chapter-1/section-100"');
    expect(xml).toContain('<num>Section 100</num>');
    expect(xml).toContain('<heading>Name</heading>');
    expect(xml).toContain('The City of Test shall be known as Test City.');
  });

  it('handles multiple paragraphs', () => {
    const html = `
      <p class="p0">First paragraph.</p>
      <p class="p1">Second paragraph.</p>
    `;

    const xml = htmlToUslm(html, {
      jurisdictionId: 'test',
      parentPath: '',
      sectionNum: '1',
      heading: 'Test',
    });

    expect(xml).toContain('<p>First paragraph.</p>');
    expect(xml).toContain('<p>Second paragraph.</p>');
  });

  it('escapes XML special characters', () => {
    const html = '<p>Section 5 &amp; 6 are about <dogs>.</p>';

    const xml = htmlToUslm(html, {
      jurisdictionId: 'test',
      parentPath: '',
      sectionNum: '5',
      heading: 'Animals & Pets',
    });

    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('& ');
  });

  it('falls back to full text when no paragraphs found', () => {
    const html = '<div>Some text without paragraph tags</div>';

    const xml = htmlToUslm(html, {
      jurisdictionId: 'test',
      parentPath: '',
      sectionNum: '1',
      heading: 'Test',
    });

    expect(xml).toContain('Some text without paragraph tags');
  });
});
