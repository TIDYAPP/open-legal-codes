import { getCodeText, getJurisdiction } from '@/lib/api';
import { AgentBanner } from '@/components/agent-banner';

export default async function CodePage({
  params,
}: {
  params: Promise<{ jurisdiction: string; path: string[] }>;
}) {
  const { jurisdiction, path } = await params;
  const codePath = path.join('/');

  let j, code;
  try {
    [j, code] = await Promise.all([
      getJurisdiction(jurisdiction),
      getCodeText(jurisdiction, codePath),
    ]);
  } catch {
    return (
      <div className="card">
        <p>Section not found.</p>
        <a href={`/${jurisdiction}`} className="mt-2 block">Back to table of contents</a>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumbs mb-4">
        <a href="/">Jurisdictions</a>
        <span className="separator">/</span>
        <a href={`/${jurisdiction}`}>{j.name}</a>
        <span className="separator">/</span>
        <span className="text-gray-900">{codePath}</span>
      </div>

      {code.num && (
        <h1 className="text-xl font-semibold mb-1">
          {code.num}{code.heading ? ` — ${code.heading}` : ''}
        </h1>
      )}
      <p className="text-sm text-gray-500 mb-4">{j.name} · {codePath}</p>

      <AgentBanner />

      <div className="card mt-4">
        <div className="whitespace-pre-wrap leading-relaxed text-sm">
          {code.text}
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-500 space-y-1">
        <p>
          Permalink: <code className="font-mono text-xs">https://openlegalcodes.org/{jurisdiction}/{codePath}</code>
        </p>
        <p>
          API: <code className="font-mono text-xs">GET https://openlegalcodes.org/api/v1/jurisdictions/{jurisdiction}/code/{codePath}</code>
        </p>
      </div>
    </div>
  );
}
