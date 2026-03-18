export const metadata = {
  title: 'Open Legal Codes — Free API for US Legal Codes',
  description: 'Free API and MCP server for AI agents to look up real municipal, state, and federal legal codes. No signup, no API key.',
};

export default function HomePage() {
  return (
    <div>
      <div className="hero">
        <h1 className="hero-title">Know what US law actually says</h1>
        <p className="hero-subtitle">
          Free API and MCP server for looking up real municipal, state, and federal legal codes.
          No signup. No API key. 37,000+ jurisdictions.
        </p>
        <div className="hero-ctas">
          <a href="/codes" className="cta-btn cta-btn-primary">Browse Codes</a>
          <a href="/developers" className="cta-btn cta-btn-secondary">View Docs</a>
        </div>
      </div>

      <h2>The problem</h2>
      <div className="prose">
        <p>
          AI agents regularly make claims about the law. &quot;You can&apos;t park there overnight.&quot;
          &quot;Your landlord must give 60 days notice.&quot; These claims are often wrong, and
          users have no way to check. Open Legal Codes gives agents access to the actual text of the
          law, so they can cite real statutes with permalink URLs that users can verify themselves.
        </p>
      </div>

      <h2>How it works</h2>
      <div className="prose">
        <ol>
          <li>User asks: <em>&quot;Can I have a dog in Mountain View?&quot;</em></li>
          <li>Agent searches: <code>search_code(&quot;ca-mountain-view&quot;, &quot;dog&quot;)</code></li>
          <li>Agent reads the actual section with <code>get_code_text</code></li>
          <li>Agent answers based on real law text, with a link to the statute</li>
          <li>User clicks the link to verify &mdash; no trust required</li>
        </ol>
      </div>

      <h2>Get started</h2>

      <h3>Install</h3>
      <div className="code-block">{`# npm
npm install -g open-legal-codes

# Homebrew (macOS / Linux)
brew install tidyapp/tap/open-legal-codes

# No install needed — just use npx or curl
npx open-legal-codes search --jurisdiction wa-seattle --query "landlord"
curl 'https://openlegalcodes.org/api/v1/lookup?city=Seattle&state=WA'`}</div>

      <h3>MCP server (for AI agents)</h3>
      <div className="prose">
        <p>Add to Claude Desktop, Claude Code, or any MCP client:</p>
      </div>
      <div className="code-block">{`{
  "mcpServers": {
    "legal-codes": {
      "url": "https://openlegalcodes.org/mcp"
    }
  }
}`}</div>

      <h3>REST API</h3>
      <div className="code-block">{`GET /api/v1/jurisdictions?state=CA          # List jurisdictions
GET /api/v1/jurisdictions/:id/toc           # Table of contents
GET /api/v1/jurisdictions/:id/code/:path    # Section text + permalink
GET /api/v1/jurisdictions/:id/search?q=dog  # Keyword search
GET /api/v1/lookup?city=Miami&state=FL      # Find by city name`}</div>

      <p className="text-sm text-muted mt-16">
        <a href="/developers">Full API docs, CLI, and MCP tool reference &rarr;</a>
      </p>

      <h2>Coverage</h2>
      <div className="prose">
        <p>
          37,000+ jurisdictions across five publishers: Municode, American Legal, eCode360,
          eCFR (federal regulations), and California Leginfo. Content is fetched on first request
          and cached &mdash; subsequent lookups are instant.
          See the <a href="/codes">full directory</a> or <a href="/map">coverage map</a>.
        </p>
      </div>

      <h2 id="roadmap">Roadmap</h2>
      <div className="prose">
        <p>
          Two things matter most right now:
        </p>
        <ol>
          <li>
            <strong>Coverage.</strong> We&apos;re focused on making sure the law is
            actually available &mdash; more jurisdictions, more publishers, better
            reliability. This is the primary goal today.
          </li>
          <li>
            <strong>Change monitoring.</strong> If you&apos;re building compliance
            software (real estate, construction, permits), you need to know when
            local laws change &mdash; not just what they say today. We want to add
            automatic change detection so you can alert your users when a relevant
            ordinance is updated. This is important and on our list, but not yet built.
          </li>
        </ol>
      </div>

      <h2>About</h2>
      <div className="prose">
        <p>
          Legal codes are public domain &mdash; the Supreme Court confirmed this
          in <em>Georgia v. Public.Resource.Org</em> (2020). Publishers host them but
          don&apos;t make them easy for agents to access. Open Legal Codes is offered free
          of charge by <a href="https://tidy.com" target="_blank" rel="noopener noreferrer">TIDY</a>,
          an AI property management company that needed this and decided to open it up.
        </p>
        <p>
          We believe the law should be machine-readable for everyone. If an AI agent can
          answer a legal question, it should be able to show its work &mdash; and every
          person should be able to verify the actual text of the laws that govern them.
        </p>
      </div>
    </div>
  );
}
