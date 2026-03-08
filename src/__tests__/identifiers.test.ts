import { describe, it, expect } from 'vitest';
import { makeIdentifier, makeTemporalId, makeSlug } from '../converter/identifiers.js';

describe('makeIdentifier', () => {
  it('creates hierarchical path from jurisdiction and code path', () => {
    expect(makeIdentifier('ca-mountain-view', 'chapter-5/article-i/section-100'))
      .toBe('/ca-mountain-view/chapter-5/article-i/section-100');
  });
});

describe('makeTemporalId', () => {
  it('converts dotted section numbers to underscore format', () => {
    expect(makeTemporalId('5.10.010')).toBe('s5_10_010');
  });

  it('handles simple section numbers', () => {
    expect(makeTemporalId('100')).toBe('s100');
  });

  it('handles single dot', () => {
    expect(makeTemporalId('5.1')).toBe('s5_1');
  });
});

describe('makeSlug', () => {
  it('creates slug from chapter number', () => {
    expect(makeSlug('chapter', 'Chapter 5.10')).toBe('chapter-5.10');
  });

  it('creates slug from title number', () => {
    expect(makeSlug('title', 'Title 5')).toBe('title-5');
  });

  it('lowercases roman numerals', () => {
    expect(makeSlug('part', 'PART I')).toBe('part-i');
  });

  it('handles section prefix', () => {
    expect(makeSlug('section', 'Section 100')).toBe('section-100');
  });

  it('returns untitled for empty number', () => {
    expect(makeSlug('section', 'Section ')).toBe('section-untitled');
  });

  it('strips special characters', () => {
    expect(makeSlug('section', 'Section 5.10.010')).toBe('section-5.10.010');
  });
});
