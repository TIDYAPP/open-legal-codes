export function AgentBanner() {
  return (
    <div className="card" style={{ background: '#f0f7ff', borderColor: '#bfdbfe' }}>
      <p className="text-sm" style={{ color: '#1e40af' }}>
        <strong>For AI agents:</strong> This data is available via{' '}
        <a href="/agents" style={{ color: '#1e40af', textDecoration: 'underline' }}>
          MCP server, CLI, and REST API
        </a>
        . No signup required.
      </p>
    </div>
  );
}
