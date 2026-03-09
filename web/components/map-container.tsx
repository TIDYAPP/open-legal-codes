'use client';

import dynamic from 'next/dynamic';
import type { GeoEntry } from '../lib/api';

const MapView = dynamic(() => import('./map-view'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
      Loading map...
    </div>
  ),
});

export default function MapContainer({ data }: { data: GeoEntry[] }) {
  return <MapView data={data} />;
}
