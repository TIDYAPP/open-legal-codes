'use client';

import { useJurisdiction } from '@/lib/jurisdiction-context';

interface TocNode {
  slug: string;
  path: string;
  num: string;
  heading: string;
  hasContent: boolean;
  children?: TocNode[];
}

function TocTree({ nodes, baseUrl }: { nodes: TocNode[]; baseUrl: string }) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path} className="toc-node">
          <div>
            {node.hasContent ? (
              <a href={`${baseUrl}/${node.path}`}>
                <span className="text-faint text-sm">{node.num}</span>{' '}
                {node.heading}
              </a>
            ) : (
              <span className="no-content">
                <strong>{node.num}</strong>
                {node.heading && <span className="text-muted"> &mdash; {node.heading}</span>}
              </span>
            )}
          </div>
          {node.children && node.children.length > 0 && (
            <div className="toc-children">
              <TocTree nodes={node.children} baseUrl={baseUrl} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function JurisdictionPage() {
  const { name, state, children, urlBase } = useJurisdiction();

  return (
    <div>
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        {state && <><a href={`/browse/${state}`}>{state}</a><span className="sep">/</span></>}
        <span>{name}</span>
      </div>

      <h1>{name}</h1>

      {children && children.length > 0 ? (
        <TocTree nodes={children} baseUrl={urlBase || ''} />
      ) : (
        <p className="text-muted">No code sections available.</p>
      )}
    </div>
  );
}
