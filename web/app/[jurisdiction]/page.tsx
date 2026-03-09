import { getToc, getJurisdiction, type TocNode } from '@/lib/api';

function TocTree({ nodes, jurisdictionId }: { nodes: TocNode[]; jurisdictionId: string }) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path} className="toc-node">
          <div>
            {node.hasContent ? (
              <a href={`/${jurisdictionId}/${node.path}`}>
                <span className="text-faint text-sm">{node.num}</span>{' '}
                {node.heading}
              </a>
            ) : (
              <span className="no-content">
                <strong>{node.num}</strong>
                {node.heading && <span className="text-muted"> — {node.heading}</span>}
              </span>
            )}
          </div>
          {node.children && node.children.length > 0 && (
            <div className="toc-children">
              <TocTree nodes={node.children} jurisdictionId={jurisdictionId} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function JurisdictionPage({
  params,
}: {
  params: Promise<{ jurisdiction: string }>;
}) {
  const { jurisdiction } = await params;

  let j, toc;
  try {
    [j, toc] = await Promise.all([
      getJurisdiction(jurisdiction),
      getToc(jurisdiction),
    ]);
  } catch {
    return (
      <div className="page">
        <p>Jurisdiction &quot;{jurisdiction}&quot; not found. <a href="/">Back</a></p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        <span>{j.name}</span>
      </div>

      <h1>{j.name}</h1>
      <p className="meta mb-16">
        {j.publisher.name}
        {j.lastCrawled && ` · ${new Date(j.lastCrawled).toLocaleDateString()}`}
        {' · '}
        <a href={`/${jurisdiction}/search`}>Search</a>
        {' · '}
        <a href={j.publisher.url} target="_blank" rel="noopener noreferrer">Source</a>
      </p>

      <TocTree nodes={toc.children} jurisdictionId={jurisdiction} />
    </div>
  );
}
