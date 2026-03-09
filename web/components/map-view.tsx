'use client';

import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import type { GeoEntry } from '../lib/api';
import 'leaflet/dist/leaflet.css';

const STATUS_COLORS: Record<string, string> = {
  cached: '#22c55e',
  available: '#3b82f6',
};

const PUBLISHER_COLORS: Record<string, string> = {
  municode: '#3b82f6',
  ecode360: '#a855f7',
  amlegal: '#f97316',
  ecfr: '#14b8a6',
  'ca-leginfo': '#ef4444',
};

interface MapViewProps {
  data: GeoEntry[];
}

export default function MapView({ data }: MapViewProps) {
  const [colorBy, setColorBy] = useState<'status' | 'publisher'>('status');

  const getColor = (d: GeoEntry) => {
    if (colorBy === 'publisher') return PUBLISHER_COLORS[d.p] || '#9ca3af';
    return STATUS_COLORS[d.s] || '#9ca3af';
  };

  const getRadius = (d: GeoEntry) => {
    if (!d.pop) return 4;
    if (d.pop > 500000) return 12;
    if (d.pop > 100000) return 8;
    if (d.pop > 10000) return 6;
    return 4;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={[39.8, -98.5]}
        zoom={4}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {data.map((d) => (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={getRadius(d)}
            pathOptions={{
              fillColor: getColor(d),
              fillOpacity: 0.8,
              color: '#fff',
              weight: 1,
              opacity: 0.6,
            }}
          >
            <Tooltip>
              <div style={{ fontWeight: 600 }}>{d.n}</div>
              <div style={{ color: '#6b7280', fontSize: '0.8125rem' }}>
                {d.p} &middot; {d.s}
                {d.pop ? ` · pop. ${d.pop.toLocaleString()}` : ''}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '12px 16px',
        fontSize: '0.8125rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        zIndex: 1000,
      }}>
        <div style={{ marginBottom: 8 }}>
          <select
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as 'status' | 'publisher')}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 4,
              padding: '2px 4px',
              fontSize: '0.8125rem',
            }}
          >
            <option value="status">Color by status</option>
            <option value="publisher">Color by publisher</option>
          </select>
        </div>
        {colorBy === 'status' ? (
          <div>
            <LegendItem color={STATUS_COLORS.cached} label="Cached" />
            <LegendItem color={STATUS_COLORS.available} label="Available" />
          </div>
        ) : (
          <div>
            {Object.entries(PUBLISHER_COLORS).map(([name, color]) => (
              <LegendItem key={name} color={color} label={name} />
            ))}
          </div>
        )}
        <div style={{ marginTop: 8, color: '#9ca3af', fontSize: '0.75rem' }}>
          {data.length.toLocaleString()} jurisdictions
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <div style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
      }} />
      <span>{label}</span>
    </div>
  );
}
