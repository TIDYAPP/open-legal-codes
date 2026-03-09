export const metadata = {
  title: 'Agents — Open Legal Codes',
  description: 'How AI agents use Open Legal Codes to verify claims against real law.',
};

export default function AgentsPage() {
  return (
    <div className="page">
      <h1>Agents</h1>
      <p className="subtitle">
        Built for AI agents that need to verify claims against actual law.
      </p>

      <h2>The problem</h2>
      <div className="prose">
        <p>
          AI agents regularly make claims about the law. &quot;You can&apos;t park there overnight.&quot;
          &quot;Your landlord must give 60 days notice.&quot; &quot;That requires a conditional use permit.&quot;
          These claims are often wrong, and users have no way to check.
        </p>
      </div>

      <h2>How it works</h2>
      <div className="prose">
        <ol>
          <li>User asks: <em>&quot;Can I have a dog in Mountain View?&quot;</em></li>
          <li>Agent searches: <code>search_code(&quot;ca-mountain-view&quot;, &quot;dog&quot;)</code></li>
          <li>Agent reads the actual section with <code>get_code_text</code></li>
          <li>Agent answers based on real law text, with a link to the statute</li>
          <li>User clicks the link to verify — no trust required</li>
        </ol>
      </div>

      <h2>Integration</h2>
      <div className="prose">
        <p>
          Connect via <a href="/developers">MCP server, REST API, or CLI</a>.
          Every response includes a permalink URL so agents can cite their sources.
          No signup, no API key.
        </p>
      </div>

      <h2>Coverage</h2>
      <div className="prose">
        <p>
          We pull from Municode, American Legal, eCode360, eCFR, and California Leginfo.
          See the <a href="/map">coverage map</a> for details. New jurisdictions are added by crawling — once
          crawled, subsequent lookups are instant.
        </p>
      </div>
    </div>
  );
}
