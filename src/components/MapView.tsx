import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cardinal, destination, formatDistance, formatElevation, type PeakView } from '../geo';

const TOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const TOPO_ATTR =
  'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)';
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface Props {
  fix: { lat: number; lon: number; accuracy: number } | null;
  peaks: PeakView[];
  heading: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  layer: 'topo' | 'osm';
  active: boolean;
}

export default function MapView({ fix, peaks, heading, selectedId, onSelect, layer, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const peakLayerRef = useRef<L.LayerGroup | null>(null);
  const hasCentered = useRef(false);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true
    }).setView([46.5, 9], 7);
    map.zoomControl.setPosition('bottomright');
    userLayerRef.current = L.layerGroup().addTo(map);
    peakLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      userLayerRef.current = null;
      peakLayerRef.current = null;
      hasCentered.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const url = layer === 'topo' ? TOPO_URL : OSM_URL;
    tileRef.current = L.tileLayer(url, {
      maxZoom: layer === 'topo' ? 17 : 19,
      attribution: layer === 'topo' ? TOPO_ATTR : OSM_ATTR,
      subdomains: 'abc'
    }).addTo(map);
  }, [layer]);

  useEffect(() => {
    if (!active) return;
    const map = mapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => map.invalidateSize(), 60);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = userLayerRef.current;
    if (!map || !layerGroup || !fix) return;
    layerGroup.clearLayers();

    L.circleMarker([fix.lat, fix.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 3,
      fillColor: '#f6b73c',
      fillOpacity: 1
    }).addTo(layerGroup);

    if (fix.accuracy > 0) {
      L.circle([fix.lat, fix.lon], {
        radius: Math.min(fix.accuracy, 500),
        color: '#f6b73c',
        weight: 1,
        opacity: 0.4,
        fillColor: '#f6b73c',
        fillOpacity: 0.08
      }).addTo(layerGroup);
    }

    if (heading != null) {
      const origin = { lat: fix.lat, lon: fix.lon };
      const points: Array<[number, number]> = [[fix.lat, fix.lon]];
      for (let offset = -26; offset <= 26; offset += 4) {
        const edge = destination(origin, heading + offset, 22000);
        points.push([edge.lat, edge.lon]);
      }
      L.polygon(points, {
        color: '#f6b73c',
        weight: 1,
        opacity: 0.55,
        fillColor: '#f6b73c',
        fillOpacity: 0.1
      }).addTo(layerGroup);
    }

    if (!hasCentered.current) {
      map.setView([fix.lat, fix.lon], 11);
      hasCentered.current = true;
    }
  }, [fix, heading]);

  useEffect(() => {
    const group = peakLayerRef.current;
    if (!group) return;
    group.clearLayers();
    for (const peak of peaks.slice(0, 400)) {
      const isSelected = peak.id === selectedId;
      const marker = L.circleMarker([peak.lat, peak.lon], {
        radius: isSelected ? 8 : 4,
        color: isSelected ? '#7dd3fc' : '#0a101c',
        weight: isSelected ? 2 : 1,
        fillColor: isSelected ? '#7dd3fc' : '#f6b73c',
        fillOpacity: 1
      });
      marker.bindTooltip(
        `<strong>${peak.name}</strong><br>${formatElevation(peak.ele)} · ${formatDistance(peak.distance)}<br>${Math.round(
          peak.bearing
        )}° ${cardinal(peak.bearing)}`,
        { direction: 'top', offset: [0, -6] }
      );
      marker.on('click', () => onSelect(isSelected ? null : peak.id));
      marker.addTo(group);
    }
  }, [peaks, selectedId, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    const timer = window.setTimeout(() => {
      const target = selectedId != null ? peaks.find((peak) => peak.id === selectedId) : null;
      if (target) map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 11), { duration: 0.7 });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [selectedId, peaks, fix]);

  return (
    <div className="map-wrap">
      <div className="map-host" ref={hostRef} />
      <div className="map-fabs">
        <button
          className="fab"
          onClick={() => {
            if (fix && mapRef.current) mapRef.current.flyTo([fix.lat, fix.lon], 12, { duration: 0.6 });
          }}
          aria-label="Recenter"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
