import { getToc, getJurisdiction, type TocNode } from '@/lib/api';
import { AgentBanner } from '@/components/agent-banner';

function TocTree({ nodes, jurisdictionId }: { nodes: TocNode[]; jurisdictionId: string }) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div key={node.path} className="toc-node">
          <div>
            {node.hasContent ? (
              <a href={`/${jurisdictionId}/${node.path}`}>
                <span className="text-gray-500 text-sm mr-2">{node.num}</span>
                {node.heading && <span>{node.heading}</span>}
              </a>
            ) : (
              <span>
                <span className="font-medium">{node.num}</span>
                {node.heading && <span className="text-gray-600"> — {node.heading}</span>}
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
      <div className="card">
        <p>Jurisdiction &quot;{jurisdiction}&quot; not found.</p>
        <a href="/" className="mt-2 block">Back to all jurisdictions</a>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumbs mb-4">
        <a href="/">Jurisdictions</a>
        <span className="separator">/</span>
        <span className="text-gray-900">{j.name}</span>
      </div>

      <h1 className="text-2xl font-semibold mb-2">{j.name}</h1>
      <p className="text-gray-600 mb-4">
        Source: {j.publisher.name}
        {j.lastCrawled && ` · Last updated: ${new Date(j.lastCrawled).toLocaleDateString()}`}
      </p>

      <div className="flex gap-4 mb-6">
        <a href={`/${jurisdiction}/search`} className="btn btn-primary">
          Search this code
        </a>
        <a href={j.publisher.url} target="_blank" rel="noopener noreferrer" className="btn">
          View on {j.publisher.name}
        </a>
      </div>

      <AgentBanner />

      <div className="mt-6">
        <h2 className="font-semibold mb-4">Table of Contents</h2>
        <TocTree nodes={toc.children} jurisdictionId={jurisdiction} />
      </div>
    </div>
  );
}
