'use client';

import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import type { LiveSnapshot } from '@/lib/types/evv';

type Active = LiveSnapshot['active'][number];

/** Default view when nothing is on the map yet (continental US). */
const FALLBACK: [number, number] = [39.5, -98.35];

function point(p: { latitude: number | null; longitude: number | null }): [number, number] | null {
  return p.latitude === null || p.longitude === null ? null : [p.latitude, p.longitude];
}

/**
 * Active visits on a map: each patient's home (grey) and where the caregiver clocked in (teal inside the geofence,
 * red outside), joined by a line. OpenStreetMap tiles; circle markers need no image assets. Loaded client-side only.
 */
export default function LiveMap({ active }: { active: Active[] }) {
  const points = active
    .flatMap((a) => [point(a.home), point(a.clockIn)])
    .filter((p): p is [number, number] => p !== null);
  const bounds = points.length > 1 ? points : undefined;
  return (
    <div role="region" aria-label="Map of active visits">
      <MapContainer
        center={points[0] ?? FALLBACK}
        zoom={points.length ? 12 : 4}
        bounds={bounds}
        boundsOptions={{ padding: [40, 40], maxZoom: 15 }}
        scrollWheelZoom={false}
        className="h-80 w-full rounded-lg border border-slate-200"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {active.map((a) => {
          const home = point(a.home);
          const clockIn = point(a.clockIn);
          const name = `${a.staff.firstName} ${a.staff.lastName} with ${a.patient.firstName} ${a.patient.lastName}`;
          const color = a.withinGeofence === false ? '#dc2626' : '#0f766e';
          return (
            <div key={a.evvRecordId}>
              {home && (
                <CircleMarker
                  center={home}
                  radius={6}
                  pathOptions={{ color: '#475569', fillOpacity: 0.4 }}
                >
                  <Tooltip>
                    Home: {a.patient.firstName} {a.patient.lastName}
                  </Tooltip>
                </CircleMarker>
              )}
              {clockIn && (
                <CircleMarker center={clockIn} radius={8} pathOptions={{ color, fillOpacity: 0.8 }}>
                  <Tooltip>
                    {name}
                    {a.withinGeofence === false ? ' — clocked in away from the home' : ''}
                  </Tooltip>
                </CircleMarker>
              )}
              {home && clockIn && (
                <Polyline
                  positions={[home, clockIn]}
                  pathOptions={{ color, weight: 1, dashArray: '4' }}
                />
              )}
            </div>
          );
        })}
      </MapContainer>
    </div>
  );
}
