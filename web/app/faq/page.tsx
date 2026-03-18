export const metadata = {
  title: 'FAQ — Open Legal Codes',
  description: 'Frequently asked questions about Open Legal Codes.',
};

export default function FAQPage() {
  return (
    <div>
      <h1>FAQ</h1>
      <p className="subtitle">How Open Legal Codes works, and why it exists.</p>

      <div className="prose">
        <h2>How do you get the data?</h2>
        <p>
          Legal codes are not copyrightable and are in the public domain. The Supreme Court
          confirmed this in{' '}
          <a href="https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc." target="_blank" rel="noopener noreferrer">
            Georgia v. Public.Resource.Org (2020)
          </a>
          . Codes are almost always hosted by one of several publishers, who do not charge
          for access. We retrieve the text from these publishers and make it available in a
          structured, machine-readable format.
        </p>

        <h2>What do publishers do?</h2>
        <p>
          Publishers help cities handle conflicts between ordinances, ensure everything is
          properly formatted, and manage the actual publication process. It is a valuable
          service that cities pay for. We are not replacing or competing with that service.
        </p>

        <h2>How current is the data?</h2>
        <p>
          Content is fetched from the publisher on first request and cached. The cache
          records when each section was last retrieved &mdash; we show the current text
          as of the last fetch, not a versioned history. To see exactly when a jurisdiction
          was last synced, check the <code>lastCrawled</code> field in{' '}
          <code>GET /jurisdictions/:id</code>. This is also shown in the browse interface
          next to each jurisdiction. We don&apos;t currently monitor for changes
          automatically &mdash; see the <a href="/#roadmap">roadmap</a> for what&apos;s
          coming.
        </p>

        <h2>How does search work?</h2>
        <p>
          Search is full-text across all indexed sections of a jurisdiction &mdash; not
          just titles or headings. Use <code>GET /jurisdictions/:id/search?q=keyword</code>{' '}
          to search within a single jurisdiction. The global{' '}
          <code>GET /search?q=keyword&amp;state=CA</code> endpoint searches across all
          jurisdictions that have already been cached. It does not search the full 37,000+
          catalog &mdash; only the subset that has been crawled. Use{' '}
          <code>GET /jurisdictions?cached=true</code> to see what&apos;s available.
        </p>

        <h2>What jurisdictions are covered?</h2>
        <p>
          See the <a href="/map">coverage map</a>. We support any jurisdiction published through
          Municode (~4,000), American Legal (~3,500), eCode360 (~4,400), plus federal
          regulations and California state statutes.
        </p>

        <h2>What are the case law citations?</h2>
        <p>
          For every statute, we show court opinions that have cited it &mdash; displayed
          in reverse chronological order (most recent first). This helps connect the text
          of the law with how courts have interpreted it in practice.
        </p>

        <h2>Where does the case law data come from?</h2>
        <p>
          All case law data comes from{' '}
          <a href="https://www.courtlistener.com" target="_blank" rel="noopener noreferrer">
            CourtListener
          </a>
          , a free and open legal database maintained by the{' '}
          <a href="https://free.law" target="_blank" rel="noopener noreferrer">
            Free Law Project
          </a>
          . CourtListener is an extraordinary public resource &mdash; they collect, archive,
          and make searchable millions of court opinions from across the US federal and state
          court systems. We link directly to their records. We do not store, host, or reproduce
          any court opinions. If you find this useful, please consider{' '}
          <a href="https://free.law/donate/" target="_blank" rel="noopener noreferrer">
            supporting the Free Law Project
          </a>
          .
        </p>

        <h2>How accurate are the case law citations?</h2>
        <p>
          They are best-effort and likely imperfect. We match statutes to court opinions
          using standard citation formats (e.g., &quot;Cal. Pen. Code &sect; 187&quot;),
          but courts cite laws inconsistently. Our automated matching will miss relevant
          opinions and may include tangential results. This works best for federal and
          state statutes where citation formats are standardized. Municipal codes are not
          yet supported because there is no standard way courts cite them.
        </p>

        <h2>Is this legal advice?</h2>
        <p>
          No. Nothing provided by Open Legal Codes constitutes legal advice or a legal opinion.
          The statute text and case law citations are provided as-is for informational purposes.
          Always consult a qualified attorney for legal matters.
        </p>
      </div>
    </div>
  );
}
