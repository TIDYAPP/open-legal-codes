import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TocTree, Jurisdiction } from '../types.js';

/**
 * CodeWriter — writes jurisdiction metadata, TOC trees, and code files to disk.
 */
export class CodeWriter {
  constructor(private codesDir: string) {}

  async writeMeta(jurisdictionId: string, meta: Record<string, unknown>): Promise<void> {
    const dir = join(this.codesDir, jurisdictionId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '_meta.json'),
      JSON.stringify(meta, null, 2) + '\n',
    );
  }

  async writeToc(jurisdictionId: string, tocTree: TocTree): Promise<void> {
    const dir = join(this.codesDir, jurisdictionId);
    await mkdir(dir, { recursive: true });

    // Strip sourceNodeId before persisting
    const cleaned = stripSourceIds(tocTree);
    await writeFile(
      join(dir, '_toc.json'),
      JSON.stringify(cleaned, null, 2) + '\n',
    );
  }

  async writeSection(
    jurisdictionId: string,
    codePath: string,
    xml: string,
    html: string,
  ): Promise<void> {
    const dir = join(this.codesDir, jurisdictionId, dirname(codePath));
    await mkdir(dir, { recursive: true });

    const basePath = join(this.codesDir, jurisdictionId, codePath);
    await writeFile(`${basePath}.xml`, xml);
    await writeFile(`${basePath}.html`, html);
  }

  async updateRegistry(jurisdiction: Jurisdiction): Promise<void> {
    const registryPath = join(this.codesDir, 'jurisdictions.json');
    let jurisdictions: Jurisdiction[] = [];

    if (existsSync(registryPath)) {
      const raw = await readFile(registryPath, 'utf-8');
      jurisdictions = JSON.parse(raw);
    }

    const idx = jurisdictions.findIndex(j => j.id === jurisdiction.id);
    if (idx >= 0) {
      jurisdictions[idx] = jurisdiction;
    } else {
      jurisdictions.push(jurisdiction);
    }

    await writeFile(registryPath, JSON.stringify(jurisdictions, null, 2) + '\n');
  }
}

function stripSourceIds(tree: TocTree): TocTree {
  return {
    ...tree,
    children: tree.children.map(stripNode),
  };
}

function stripNode(node: any): any {
  const { sourceNodeId, children, ...rest } = node;
  return {
    ...rest,
    ...(children?.length ? { children: children.map(stripNode) } : {}),
  };
}
