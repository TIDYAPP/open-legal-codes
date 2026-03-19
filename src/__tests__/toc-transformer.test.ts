import { describe, it, expect } from 'vitest';
import { transformToc, flattenContentNodes } from '../crawlers/toc-transformer.js';
import type { RawTocNode } from '../types.js';

describe('transformToc', () => {
  it('transforms raw TOC into normalized tree', () => {
    const raw: RawTocNode[] = [
      {
        id: 'CH1',
        title: 'CHAPTER 1 - GENERAL PROVISIONS',
        level: 'chapter',
        hasContent: false,
        children: [
          {
            id: 'S1.1',
            title: 'Section 1.1. - Definitions.',
            level: 'section',
            hasContent: true,
            children: [],
          },
        ],
      },
    ];

    const tree = transformToc(raw, 'test-city', 'Test City Code');

    expect(tree.jurisdiction).toBe('test-city');
    expect(tree.title).toBe('Test City Code');
    expect(tree.children).toHaveLength(1);

    const chapter = tree.children[0];
    expect(chapter.level).toBe('chapter');
    expect(chapter.num).toBe('CHAPTER 1');
    expect(chapter.heading).toBe('General Provisions');
    expect(chapter.slug).toBe('chapter-1');
    expect(chapter.path).toBe('chapter-1');

    const section = chapter.children![0];
    expect(section.level).toBe('section');
    expect(section.num).toBe('Section 1.1');
    expect(section.heading).toBe('Definitions');
    expect(section.hasContent).toBe(true);
    expect(section.path).toBe('chapter-1/section-1.1');
  });

  it('handles titles without separators', () => {
    const raw: RawTocNode[] = [
      {
        id: 'X1',
        title: 'SUPPLEMENT HISTORY TABLE',
        level: 'part',
        hasContent: true,
        children: [],
      },
    ];

    const tree = transformToc(raw, 'test', 'Test');
    expect(tree.children[0].num).toBe('SUPPLEMENT HISTORY TABLE');
    expect(tree.children[0].heading).toBe('');
  });

  it('collapses duplicate container nodes (Austin chapter-2-15 bug)', () => {
    const raw: RawTocNode[] = [
      {
        id: 'CH2-15',
        title: 'CHAPTER 2-15 - POLICE OVERSIGHT',
        level: 'chapter',
        hasContent: false,
        children: [
          {
            id: 'CH2-15_DUP',
            title: 'CHAPTER 2-15 - POLICE OVERSIGHT',
            level: 'chapter',
            hasContent: false,
            children: [
              {
                id: 'S2-15-1',
                title: 'Section 2-15-1. - Definitions.',
                level: 'section',
                hasContent: true,
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const tree = transformToc(raw, 'test-austin', 'Test Austin Code');
    const chapter = tree.children[0];

    // The duplicate nesting should be collapsed
    expect(chapter.slug).toBe('chapter-2-15');
    expect(chapter.path).toBe('chapter-2-15');
    // The section should be a direct child, not nested under a duplicate
    expect(chapter.children).toHaveLength(1);
    expect(chapter.children![0].path).toBe('chapter-2-15/section-2-15-1');
  });

  it('propagates codeId to the tree', () => {
    const raw: RawTocNode[] = [
      {
        id: 'CH1',
        title: 'CHAPTER 1 - TEST',
        level: 'chapter',
        hasContent: true,
        children: [],
      },
    ];

    const tree = transformToc(raw, 'test', 'Test', 'land-development');
    expect(tree.codeId).toBe('land-development');
  });
});

describe('flattenContentNodes', () => {
  it('extracts all leaf nodes with content', () => {
    const raw: RawTocNode[] = [
      {
        id: 'CH1',
        title: 'CHAPTER 1 - GENERAL',
        level: 'chapter',
        hasContent: false,
        children: [
          { id: 'S1', title: 'Section 1. - Name.', level: 'section', hasContent: true, children: [] },
          { id: 'S2', title: 'Section 2. - Scope.', level: 'section', hasContent: true, children: [] },
        ],
      },
      {
        id: 'TOP',
        title: 'PREAMBLE',
        level: 'part',
        hasContent: true,
        children: [],
      },
    ];

    const tree = transformToc(raw, 'test', 'Test');
    const flat = flattenContentNodes(tree);

    expect(flat).toHaveLength(3);
    expect(flat[0].path).toBe('chapter-1/section-1');
    expect(flat[1].path).toBe('chapter-1/section-2');
    expect(flat[2].path).toBe('part-preamble');
  });
});
