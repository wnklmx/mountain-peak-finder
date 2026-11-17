import { useEffect, useMemo, useRef, useState } from 'react';
import { cardinal, formatDistance, formatElevation, normalize180, normalize360, type PeakView } from '../geo';
import type { HorizonProfile } from '../worker/terrain.worker';

const DEFAULT_FOV = 90;

/** Top colour of each distance band's fill, nearest first. */
const BAND_TOP = ['#101c2b', '#16233a', '#1c2c47', '#233655'];
const BAND_LATERAL = ['#7c8fa6', '#6a7f99', '#58708c', '#465e7a'];

export interface PanoramaProps {
  peaks: PeakView[];
  viewBearing: number;
  onViewBearing: (bearing: number) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  heading: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  radiusKm: number;
  altitudeKnown: boolean;
  horizon: HorizonProfile | null;
  hidden: Set<number>;
  /** Horizontal field of view in degrees. 90 for the plain panorama, the
   * camera's own lens width when the video is behind the overlay. */
  fov?: number;
  /** No sky or ground fill: the ridge is drawn over the live camera. */
  camera?: boolean;
  /** Draw the peaks the terrain hides, as hollow rings. */
  showHidden?: boolean;
  onToggleHidden?: () => void;
  /** Present when the caller can switch to the camera overlay. */
  onCamera?: () => void;
}

interface PlacedLabel {
  x: number;
  y: number;
  peak: PeakView;
  selected: boolean;
}

/** Linear interpolation of a horizon angle series at an arbitrary bearing. */
export function horizonAngleAt(angles: Float32Array, step: number, bearing: number): number | null {
  const count = angles.length;
  if (!count) return null;
  const t = normalize360(bearing) / step;
  const i = Math.floor(t) % count;
  const j = (i + 1) % count;
  const f = t - Math.floor(t);
  const a = angles[i];
  const b = angles[j];
  if (a < -89 || b < -89) return a < -89 ? (b < -89 ? null : b) : a;
  return a + (b - a) * f;
}

export default function Panorama({
  peaks,
  viewBearing,
  onViewBearing,
  follow,
  onFollowChange,
  heading,
  selectedId,
  onSelect,
  radiusKm,
  altitudeKnown,
  horizon,
  hidden,
  fov = DEFAULT_FOV,
  camera = false,
  showHidden = false,
  onToggleHidden,
  onCamera
}: PanoramaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ startX: number; startBearing: number } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { w, h } = size;
  const plotTop = camera ? 58 : 66;
  const plotBottom = Math.max(plotTop + 80, h - (camera ? 92 : 104));

  const inView = useMemo(() => {
    return peaks
      .map((peak) => ({ peak, rel: normalize180(peak.bearing - viewBearing) }))
      .filter((entry) => Math.abs(entry.rel) < fov / 2 + 1)
      .sort((a, b) => b.peak.angle - a.peak.angle);
  }, [peaks, viewBearing, fov]);

  const visible = useMemo(
    () => inView.filter((entry) => !hidden.has(entry.peak.id) || entry.peak.id === selectedId),
    [inView, hidden, selectedId]
  );

  const hiddenInView = inView.length - visible.length;

  // A stable vertical window: the whole skyline, not just the current view, so
  // the scale does not jump while panning.
  const vertical = useMemo(() => {
    let max = 1.2;
    let min = -0.4;
    if (horizon) {
      for (let i = 0; i < horizon.angles.length; i++) {
        const a = horizon.angles[i];
        if (a > max) max = a;
        if (a < min && a > -25) min = a;
      }
    } else {
      for (const entry of visible) {
        if (entry.peak.angle > max) max = entry.peak.angle;
        if (entry.peak.angle < min) min = entry.peak.angle;
      }
    }
    const top = Math.max(0.9, max + 0.45);
    const bottom = Math.min(-0.5, min - 0.3);
    return { top, span: Math.max(0.9, top - bottom), bottom };
  }, [horizon, visible]);

  const { top: topAngle, bottom: bottomAngle, span } = vertical;
  const yFor = (angle: number) => plotBottom - ((angle - bottomAngle) / span) * (plotBottom - plotTop);
  const xFor = (rel: number) => w / 2 + (rel / fov) * w;
  const horizonY = yFor(0);

  const skyline = useMemo(() => {
    if (!horizon || !w) return null;
    const series = horizon.bands && horizon.bands.length ? horizon.bands : [horizon.angles];
    const cuts = horizon.cuts && horizon.cuts.length ? horizon.cuts : [Infinity];
    const columns = Math.max(80, Math.ceil(w / 2));
    const layers: Array<{ path: string; line: string; fill: string; stroke: string }> = [];

    for (let s = series.length - 1; s >= 0; s--) {
      const angles = series[s];
      const cut = cuts[Math.min(s, cuts.length - 1)];
      const columnAngles: Array<number | null> = [];
      for (let i = 0; i <= columns; i++) {
        const x = (i / columns) * w;
        const bearing = viewBearing + ((x - w / 2) / w) * fov;
        columnAngles.push(horizonAngleAt(angles, horizon.step, bearing));
      }

      // The 0.5° profile plus smoothing rounds off sharp summits by up to a
      // degree, which used to leave the peak dots floating above the ridge.
      // Lift the silhouette onto every visible summit in this layer's range.
      for (const { peak, rel } of visible) {
        if (peak.distance > cut) continue;
        const center = Math.round((1 / 2 + rel / fov) * columns);
        const side = Math.max(1, Math.round(columns / 90));
        for (let d = -side; d <= side; d++) {
          const i = center + d;
          if (i < 0 || i > columns) continue;
          const target = d === 0 ? peak.angle : peak.angle - 0.4;
          const current = columnAngles[i];
          if (current == null || target > current) columnAngles[i] = target;
        }
      }
      // Carry the nearest known value across gaps so the silhouette stays one
      // closed shape instead of sprouting diagonals to the bottom corner.
      const first = columnAngles.find((value) => value != null);
      if (first == null) continue;
      let carry = first;
      const points: Array<[number, number]> = [];
      let maxY = -Infinity;
      for (let i = 0; i <= columns; i++) {
        const value = columnAngles[i];
        if (value != null) carry = value;
        const y = Math.max(plotTop - 60, Math.min(h, yFor(carry)));
        if (y > maxY) maxY = y;
        points.push([(i / columns) * w, y]);
      }
      // A layer entirely under the bottom edge adds nothing but artefacts.
      if (maxY >= h - 1) continue;
      const line = points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');
      layers.push({
        path: `M ${line} L ${w} ${h} L 0 ${h} Z`,
        line: `M ${line}`,
        fill: `url(#band${Math.min(s, BAND_TOP.length - 1)})`,
        stroke: BAND_LATERAL[s] ?? BAND_LATERAL[BAND_LATERAL.length - 1]
      });
    }
    return layers.length ? layers : null;
  }, [horizon, w, viewBearing, fov, bottomAngle, span, plotTop, plotBottom, visible]);

  const selected = selectedId != null ? peaks.find((peak) => peak.id === selectedId) ?? null : null;

  const labels = useMemo<PlacedLabel[]>(() => {
    if (!w) return [];
    const occupied: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const placed: PlacedLabel[] = [];
    const sectors = new Map<number, number>();

    for (const entry of visible) {
      if (placed.length >= 14) break;
      if (Math.abs(entry.rel) > fov / 2) continue;
      const sector = Math.floor((entry.rel + fov / 2) / (fov / 6));
      if ((sectors.get(sector) ?? 0) >= 3) continue;
      const markerX = xFor(entry.rel);
      if (markerX < 0 || markerX > w) continue;

      const markerY = yFor(entry.peak.angle);
      const labelWidth = Math.min(230, Math.max(52, entry.peak.name.length * 6.4 + 60));
      const cx = Math.max(labelWidth / 2 + 6, Math.min(w - labelWidth / 2 - 6, markerX));
      const candidates = [markerY - 12, markerY - 29, markerY - 46, markerY + 20, markerY + 37];

      let chosen: number | null = null;
      for (const candidate of candidates) {
        if (candidate < plotTop + 10 || candidate > plotBottom - 2) continue;
        const box = {
          x0: cx - labelWidth / 2 - 4,
          x1: cx + labelWidth / 2 + 4,
          y0: candidate - 11,
          y1: candidate + 4
        };
        const clash = occupied.some(
          (other) => box.x1 > other.x0 && box.x0 < other.x1 && box.y1 > other.y0 && box.y0 < other.y1
        );
        if (clash) continue;
        chosen = candidate;
        occupied.push(box);
        break;
      }

      if (chosen == null) continue;
      sectors.set(sector, (sectors.get(sector) ?? 0) + 1);
      placed.push({ x: cx, y: chosen, peak: entry.peak, selected: entry.peak.id === selectedId });
    }
    return placed;
  }, [visible, w, selectedId, bottomAngle, span, plotTop, plotBottom, fov]);

  const labelledIds = useMemo(() => new Set(labels.map((label) => label.peak.id)), [labels]);

  const ticks = useMemo(() => {
    if (!w) return [];
    const out: Array<{ x: number; bearing: number; major: boolean }> = [];
    const start = Math.ceil((viewBearing - fov / 2) / 10) * 10;
    for (let bearing = start; bearing <= viewBearing + fov / 2; bearing += 10) {
      const rel = normalize180(bearing - viewBearing);
      out.push({ x: xFor(rel), bearing: normalize360(bearing), major: normalize360(bearing) % 30 === 0 });
    }
    return out;
  }, [viewBearing, w, fov]);

  const headingRel = heading != null ? normalize180(heading - viewBearing) : null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startBearing: viewBearing };
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (follow) onFollowChange(false);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !w) return;
    if (Math.abs(event.clientX - drag.startX) > 6) movedRef.current = true;
    const delta = ((event.clientX - drag.startX) / w) * fov;
    onViewBearing(normalize360(drag.startBearing - delta));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  if (!w || !h) {
    return <div className="panorama" ref={containerRef} />;
  }

  return (
    <div
      className={`panorama ${camera ? 'panorama-camera' : ''}`}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg width={w} height={h} className="panorama-svg">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#050a12" />
            <stop offset="62%" stopColor="#0f1c2e" />
            <stop offset="100%" stopColor="#22384f" />
          </linearGradient>
          <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b2b40" />
            <stop offset="45%" stopColor="#111d2c" />
            <stop offset="100%" stopColor="#060b12" />
          </linearGradient>
          {BAND_TOP.map((color, index) => (
            <linearGradient key={`band-${index}`} id={`band${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} />
              <stop offset="55%" stopColor={color} stopOpacity={0.82} />
              <stop offset="100%" stopColor="#050810" />
            </linearGradient>
          ))}
        </defs>

        {camera ? null : (
          <>
            <rect x={0} y={0} width={w} height={h} fill="url(#sky)" />
            {skyline ? (
              skyline.map((layer, index) => <path key={`fill-${index}`} d={layer.path} fill={layer.fill} />)
            ) : (
              <rect x={0} y={Math.max(0, horizonY)} width={w} height={Math.max(0, h - horizonY)} fill="url(#rock)" />
            )}
          </>
        )}

        {camera ? null : (
          <>
            {[1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30].map((deg) =>
              deg >= bottomAngle && deg <= topAngle ? (
                <g key={`grid-${deg}`}>
                  <line
                    x1={0}
                    x2={w}
                    y1={yFor(deg)}
                    y2={yFor(deg)}
                    stroke="#ffffff"
                    strokeOpacity={0.045}
                    strokeDasharray="2 6"
                  />
                  <text x={7} y={yFor(deg) - 4} fontSize={8} fill="#46586f">
                    +{deg}°
                  </text>
                </g>
              ) : null
            )}
            <line x1={0} x2={w} y1={horizonY} y2={horizonY} stroke="#7dd3fc" strokeOpacity={0.2} strokeDasharray="1 5" />
          </>
        )}

        {skyline
          ? skyline.map((layer, index) => (
              <path
                key={`ridge-${index}`}
                d={layer.line}
                fill="none"
                stroke={camera ? '#dbeafe' : layer.stroke}
                strokeOpacity={camera ? 0.9 : index === skyline.length - 1 ? 0.55 : 0.28}
                strokeWidth={camera ? 1.5 : 1}
                strokeLinejoin="round"
              />
            ))
          : null}

        {inView.slice(0, 260).map(({ peak, rel }) => {
          const x = xFor(rel);
          const y = yFor(peak.angle);
          const isSelected = peak.id === selectedId;
          const isHidden = hidden.has(peak.id);
          if (isHidden && !showHidden && !isSelected) return null;
          const showStem = isSelected || labelledIds.has(peak.id);
          return (
            <g key={peak.id}>
              {showStem ? (
                <line
                  x1={x}
                  y1={Math.min(y, Math.max(0, horizonY))}
                  x2={x}
                  y2={y}
                  stroke={isSelected ? '#7dd3fc' : '#f6b73c'}
                  strokeOpacity={isSelected ? 0.55 : 0.3}
                  strokeWidth={1}
                />
              ) : null}
              <g
                onClick={(event) => {
                  event.stopPropagation();
                  if (!movedRef.current) onSelect(isSelected ? null : peak.id);
                }}
                className="peak-hit"
                role="button"
                tabIndex={-1}
                aria-label={`${peak.name}, ${Math.round(peak.ele)} metres`}
              >
                <circle cx={x} cy={y} r={15} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 5.2 : isHidden ? 2.6 : 2.7}
                  fill={isHidden ? 'none' : isSelected ? '#7dd3fc' : '#f6b73c'}
                  fillOpacity={isSelected || showStem ? 1 : 0.7}
                  stroke={isHidden ? '#5b6b83' : '#080e18'}
                  strokeWidth={isHidden ? 1.2 : isSelected ? 1.5 : 1}
                />
              </g>
            </g>
          );
        })}

        {labels.map((label) => (
          <text
            key={`label-${label.peak.id}`}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={label.selected ? '#7dd3fc' : '#e9eff8'}
            stroke={camera ? '#04070c' : '#050a12'}
            strokeWidth={camera ? 3.4 : 2.6}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {label.peak.name}
            <tspan fontSize={9.5} fontWeight={400} fill="#93a4bd">
              {'  '}
              {Math.round(label.peak.ele).toLocaleString('en-US')} m
            </tspan>
          </text>
        ))}

        {headingRel != null && Math.abs(headingRel) <= fov / 2 ? (
          <g>
            <line
              x1={xFor(headingRel)}
              x2={xFor(headingRel)}
              y1={plotTop - 4}
              y2={plotBottom + 8}
              stroke="#f6b73c"
              strokeOpacity={0.38}
              strokeWidth={1.5}
            />
            <path
              d={`M ${xFor(headingRel) - 5} ${plotTop - 12} L ${xFor(headingRel) + 5} ${plotTop - 12} L ${xFor(headingRel)} ${plotTop - 4} Z`}
              fill="#f6b73c"
            />
          </g>
        ) : null}

        {camera ? null : (
          <>
            {ticks.map((tick) => (
              <g key={`tick-${tick.bearing}`}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={plotBottom + 12}
                  y2={plotBottom + (tick.major ? 22 : 17)}
                  stroke="#3b4c66"
                  strokeWidth={1}
                />
                {tick.x > 14 && tick.x < w - 14 ? (
                  <text
                    x={tick.x}
                    y={plotBottom + 36}
                    textAnchor="middle"
                    fontSize={10}
                    fill={tick.major ? '#b9c8dc' : '#6d7f99'}
                  >
                    {Math.round(tick.bearing)}
                  </text>
                ) : null}
                {tick.bearing % 90 === 0 && tick.x > 14 && tick.x < w - 14 ? (
                  <text
                    x={tick.x}
                    y={plotBottom + 54}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill="#f6b73c"
                  >
                    {cardinal(tick.bearing)}
                  </text>
                ) : null}
              </g>
            ))}
            <line x1={w / 2} x2={w / 2} y1={plotTop - 18} y2={plotTop + 6} stroke="#f6b73c" strokeWidth={2} opacity={0.8} />
          </>
        )}
      </svg>

      <div className="panorama-top">
        <div className="panorama-row">
          <div className="panorama-heading">
            <span className="deg">{Math.round(viewBearing)}°</span>
            <span className="card">{cardinal(viewBearing)}</span>
          </div>
          <div className="panorama-actions">
            <button className={`lock-btn ${follow ? 'on' : ''}`} onClick={() => onFollowChange(!follow)}>
              {follow ? 'Locked' : 'Free'}
            </button>
            {onCamera ? (
              <button className="cam-btn" onClick={onCamera} aria-label="Open the camera">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M3 8.5A2 2 0 0 1 5 6.5h2l1.3-2h7.4L17 6.5h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  <circle cx="12" cy="12.8" r="3.4" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <div className="panorama-meta">
          <span>{visible.length} peaks</span>
          {hiddenInView > 0 ? (
            <>
              <span className="dot">·</span>
              <button className={`hidden-toggle ${showHidden ? 'on' : ''}`} onClick={onToggleHidden}>
                {hiddenInView.toLocaleString('en-US')} hidden
              </button>
            </>
          ) : null}
          <span className="dot">·</span>
          <span>{radiusKm} km</span>
        </div>
      </div>

      <div className="panorama-bottom">
        {selected ? (
          <div className="detail-card">
            <div className="detail-head">
              <span className="detail-name">{selected.name}</span>
              <button className="detail-close" onClick={() => onSelect(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="detail-grid">
              <div>
                <span className="detail-label">Elevation</span>
                <span className="detail-value">{formatElevation(selected.ele)}</span>
              </div>
              <div>
                <span className="detail-label">Distance</span>
                <span className="detail-value">{formatDistance(selected.distance)}</span>
              </div>
              <div>
                <span className="detail-label">Bearing</span>
                <span className="detail-value">
                  {Math.round(selected.bearing)}° {cardinal(selected.bearing)}
                </span>
              </div>
              <div>
                <span className="detail-label">Above eye</span>
                <span className="detail-value">
                  {selected.angle >= 0 ? '+' : ''}
                  {selected.angle.toFixed(1)}°
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="hint">
            {peaks.length === 0
              ? 'No peaks in range — widen the radius in settings.'
              : 'Drag to look around · tap a peak for details'}
            {!altitudeKnown ? <span className="hint-warn">Altitude unknown — angles may be off</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
