import MapContainer from '../../components/map-container';
import { getRegistryGeo, getRegistryStats } from '../../lib/api';

export const metadata = {
  title: 'Map — Open Legal Codes',
  description: 'Interactive map of US jurisdictions with available legal codes.',
};

export default async function MapPage() {
  let data: Awaited<ReturnType<typeof getRegistryGeo>> = [];
  let stats: Awaited<ReturnType<typeof getRegistryStats>> | null = null;

  try {
    [data, stats] = await Promise.all([getRegistryGeo(), getRegistryStats()]);
  } catch {
    // Registry may not be built yet
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div style={{ padding: '8px 24px', borderBottom: '1px solid #e5e5e5' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Coverage Map</span>
            {stats && (
              <span style={{ fontSize: 13, color: '#666', marginLeft: 12 }}>
                {stats.total.toLocaleString()} jurisdictions · {Object.keys(stats.byState).length} states · {(stats.byStatus['cached'] || 0).toLocaleString()} cached
              </span>
            )}
          </div>
          {stats && (
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#999' }}>
              {Object.entries(stats.byPublisher)
                .sort(([, a], [, b]) => b - a)
                .map(([pub, count]) => (
                  <span key={pub}>{pub}: {count.toLocaleString()}</span>
                ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {data.length > 0 ? (
          <MapContainer data={data} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            <p>No registry data yet. Run <code style={{ background: '#f7f7f7', padding: '2px 6px', borderRadius: 3 }}>npx tsx src/cli.ts catalog</code> to scan publishers.</p>
          </div>
        )}
      </div>
    </div>
  );
}
