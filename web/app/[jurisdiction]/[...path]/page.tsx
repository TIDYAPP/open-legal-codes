import { getCodeText, getJurisdiction } from '@/lib/api';

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
      <div className="page">
        <p>Section not found. <a href={`/${jurisdiction}`}>Back to table of contents</a></p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <a href="/">Codes</a>
        <span className="sep">/</span>
        <a href={`/${jurisdiction}`}>{j.name}</a>
        <span className="sep">/</span>
        <span>{codePath}</span>
      </div>

      {code.num && (
        <h1>{code.num}{code.heading ? ` — ${code.heading}` : ''}</h1>
      )}
      <p className="meta mb-16">{j.name}</p>

      <div className="section-text">{code.text}</div>

      <div className="meta mt-24">
        <p>Permalink: <code>openlegalcodes.org/{jurisdiction}/{codePath}</code></p>
        <p>API: <code>GET /api/v1/jurisdictions/{jurisdiction}/code/{codePath}</code></p>
      </div>
    </div>
  );
}
