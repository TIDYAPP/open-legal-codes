import { getJurisdictions, type Jurisdiction } from '@/lib/api';
import { AgentBanner } from '@/components/agent-banner';

export default async function HomePage() {
  let jurisdictions: Jurisdiction[];
  try {
    jurisdictions = await getJurisdictions();
  } catch {
    jurisdictions = [];
  }

  // Group by state
  const byState: Record<string, typeof jurisdictions> = {};
  for (const j of jurisdictions) {
    const state = j.state || 'Other';
    if (!byState[state]) byState[state] = [];
    byState[state].push(j);
  }
  const states = Object.keys(byState).sort();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Browse US Legal Codes</h1>
      <p className="text-gray-600 mb-6">
        Free, open-source access to municipal codes. Select a jurisdiction to browse its legal code.
      </p>

      <AgentBanner />

      <div className="mt-6">
        {jurisdictions.length === 0 ? (
          <div className="card">
            <p className="text-gray-500">
              No jurisdictions loaded. Run <code className="font-mono text-sm">npx tsx src/cli.ts crawl --jurisdiction ca-mountain-view</code> to crawl a jurisdiction first.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {states.map((state) => (
              <div key={state}>
                <h2 className="font-semibold text-gray-600 text-sm mb-2">{state}</h2>
                <div className="grid grid-cols-1 md-grid-cols-2 gap-2">
                  {byState[state].map((j) => (
                    <a key={j.id} href={`/${j.id}`} className="card" style={{ textDecoration: 'none' }}>
                      <div className="font-medium text-gray-900">{j.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {j.publisher.name} &middot; {j.id}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
