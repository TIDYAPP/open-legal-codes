export const metadata = {
  title: 'Terms — Open Legal Codes',
  description: 'Terms of use for Open Legal Codes.',
};

export default function TermsPage() {
  return (
    <div className="page">
      <h1>Terms</h1>
      <p className="subtitle">Terms of use.</p>

      <div className="prose">
        <h2>The law is public domain</h2>
        <p>
          The text of US legal codes is not copyrightable. The Supreme Court confirmed
          this in <a href="https://en.wikipedia.org/wiki/Georgia_v._Public.Resource.Org,_Inc." target="_blank" rel="noopener noreferrer">
          Georgia v. Public.Resource.Org, Inc. (2020)</a>. You are free to read, copy,
          and redistribute the text of any law.
        </p>

        <h2>No legal advice</h2>
        <p>
          This service provides access to legal text. It does not provide legal advice.
          We make no guarantees about the completeness, accuracy, or currency of any
          content. Always consult the official published code and a qualified attorney
          for legal matters.
        </p>

        <h2>No warranty</h2>
        <p>
          This service is provided &quot;as is&quot; without warranty of any kind. We do not
          guarantee uptime, accuracy, or availability. Content may be outdated —
          check the &quot;last retrieved&quot; timestamp on each section.
        </p>

        <h2>API usage</h2>
        <p>
          There are currently no rate limits or API keys. We reserve the right to
          introduce rate limiting if needed to maintain service quality. Please be
          respectful with automated requests.
        </p>

        <h2>Open source</h2>
        <p>
          This project is open source. The source code is available on{' '}
          <a href="https://github.com/mchusma/open-legal-codes" target="_blank" rel="noopener noreferrer">GitHub</a>.
        </p>
      </div>
    </div>
  );
}
