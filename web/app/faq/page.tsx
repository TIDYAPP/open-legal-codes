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
          Content is fetched on first request and cached. The cache records when each
          section was last retrieved. We don&apos;t do full versioning &mdash; we show the
          current text as of the last fetch.
        </p>

        <h2>What jurisdictions are covered?</h2>
        <p>
          See the <a href="/map">coverage map</a>. We support any jurisdiction published through
          Municode (~4,000), American Legal (~3,500), eCode360 (~4,400), plus federal
          regulations and California state statutes.
        </p>
      </div>
    </div>
  );
}
