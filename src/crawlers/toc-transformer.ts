import type { RawTocNode } from './types.js';
import type { TocNode, TocTree, TocLevel } from '../types.js';
import { makeSlug } from '../converter/identifiers.js';

const VALID_LEVELS: Set<string> = new Set([
  'title', 'subtitle', 'chapter', 'subchapter', 'article', 'subarticle',
  'division', 'subdivision', 'part', 'subpart', 'section',
]);

/**
 * Convert a raw TOC tree from a crawler into our normalized TocTree format.
 */
export function transformToc(
  raw: RawTocNode[],
  jurisdictionId: string,
  codeName: string,
): TocTree {
  return {
    jurisdiction: jurisdictionId,
    title: codeName,
    children: raw.map(node => transformNode(node, '')),
  };
}

function transformNode(raw: RawTocNode, parentPath: string): TocNode {
  const { num, heading } = parseTocTitle(raw.title);
  const level = normalizeLevel(raw.level);
  const slug = makeSlug(level, num || raw.title);

  const path = parentPath ? `${parentPath}/${slug}` : slug;

  return {
    slug,
    path,
    level,
    num: num || raw.title,
    heading,
    hasContent: raw.hasContent,
    sourceNodeId: raw.id,
    children: raw.children.map(child => transformNode(child, path)),
  };
}

/**
 * Parse a Municode title like "CHAPTER 5 - ANIMALS" into num and heading.
 *
 * Common formats:
 *   "CHAPTER 5 - ANIMALS"
 *   "Section 100. - Name."
 *   "1100. - Short title; reference to Code."
 *   "ARTICLE I. - GENERALLY."
 *   "PART I - THE CHARTER"
 */
function parseTocTitle(text: string): { num: string; heading: string } {
  // Try: "CHAPTER 5 - ANIMALS" or "Section 100. - Name."
  // The key separator is " - " (space-dash-space), possibly preceded by a period
  const match = text.match(/^(.+?)\.?\s+[-–—]\s+(.+)$/);
  if (match) {
    const rawNum = match[1].trim();
    const rawHeading = match[2].trim().replace(/\.\s*$/, '');
    return { num: rawNum, heading: titleCase(rawHeading) };
  }

  // No separator found — use the whole string
  return { num: text.trim(), heading: '' };
}

function normalizeLevel(level: string): TocLevel {
  const lower = level.toLowerCase();
  if (VALID_LEVELS.has(lower)) return lower as TocLevel;
  return 'section';
}

function titleCase(s: string): string {
  if (s === s.toUpperCase() && s.length > 3) {
    // ALL CAPS — convert to title case
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return s;
}

/**
 * Flatten a TocTree to get all leaf nodes that have content.
 */
export function flattenContentNodes(tree: TocTree): TocNode[] {
  const result: TocNode[] = [];
  function walk(nodes: TocNode[]) {
    for (const node of nodes) {
      if (node.hasContent) {
        result.push(node);
      }
      if (node.children) {
        walk(node.children);
      }
    }
  }
  walk(tree.children);
  return result;
}
