import { useEffect, useMemo, useRef, useState } from 'react';
import { cardinal, formatDistance, formatElevation, normalize180, type PeakView } from '../geo';

const FOV = 90;

interface Props {
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
}

interface PlacedLabel {
  x: number;
  y: number;
  peak: PeakView;
  selected: boolean;
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
  altitudeKnown
}: Props) {
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
  const plotTop = 74;
  const plotBottom = Math.max(plotTop + 80, h - 112);

  const visible = useMemo(() => {
    return peaks
      .map((peak) => ({ peak, rel: normalize180(peak.bearing - viewBearing) }))
      .filter((entry) => Math.abs(entry.rel) < FOV / 2 + 1)
      .sort((a, b) => b.peak.angle - a.peak.angle);
  }, [peaks, viewBearing]);

  const angles = visible.map((entry) => entry.peak.angle);
  const maxAngle = angles.length ? Math.max(...angles) : 1;
  const minAngle = angles.length ? Math.min(...angles) : 0;
  const topAngle = Math.max(0.7, maxAngle) + 0.35;
  const bottomAngle = Math.min(-0.5, minAngle) - 0.2;
  const span = Math.max(0.8, topAngle - bottomAngle);

  const yFor = (angle: number) => plotBottom - ((angle - bottomAngle) / span) * (plotBottom - plotTop);
  const xFor = (rel: number) => w / 2 + (rel / FOV) * w;
  const horizonY = yFor(0);

  const selected = selectedId != null ? peaks.find((peak) => peak.id === selectedId) ?? null : null;

  const labels = useMemo<PlacedLabel[]>(() => {
    if (!w) return [];
    const occupied: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const placed: PlacedLabel[] = [];
    const sectors = new Map<number, number>();

    for (const entry of visible) {
      if (placed.length >= 16) break;
      if (Math.abs(entry.rel) > FOV / 2) continue;
      const sector = Math.floor((entry.rel + FOV / 2) / (FOV / 6));
      if ((sectors.get(sector) ?? 0) >= 3) continue;
      const markerX = xFor(entry.rel);
      if (markerX < 0 || markerX > w) continue;

      const markerY = yFor(entry.peak.angle);
      const labelWidth = Math.min(240, Math.max(54, entry.peak.name.length * 6.6 + 62));
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
  }, [visible, w, selectedId, bottomAngle, span, plotTop, plotBottom]);

  const labelledIds = useMemo(() => new Set(labels.map((label) => label.peak.id)), [labels]);

  const ticks = useMemo(() => {
    if (!w) return [];
    const out: Array<{ x: number; bearing: number; major: boolean }> = [];
    const start = Math.ceil((viewBearing - FOV / 2) / 10) * 10;
    for (let bearing = start; bearing <= viewBearing + FOV / 2; bearing += 10) {
      const rel = normalize180(bearing - viewBearing);
      out.push({ x: xFor(rel), bearing: ((bearing % 360) + 360) % 360, major: bearing % 30 === 0 });
    }
    return out;
  }, [viewBearing, w]);

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
    const delta = ((event.clientX - drag.startX) / w) * FOV;
    onViewBearing(((drag.startBearing - delta) % 360 + 360) % 360);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  if (!w || !h) {
    return <div className="panorama" ref={containerRef} />;
  }

  return (
    <div
      className="panorama"
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg width={w} height={h} className="panorama-svg">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#060c16" />
            <stop offset="70%" stopColor="#122135" />
            <stop offset="100%" stopColor="#1d3247" />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#132033" />
            <stop offset="100%" stopColor="#070c14" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={w} height={Math.max(0, horizonY)} fill="url(#sky)" />
        <rect x={0} y={Math.max(0, horizonY)} width={w} height={Math.max(0, h - horizonY)} fill="url(#ground)" />

        {[1, 2, 3, 4, 5, 6, 8, 10].map((deg) =>
          deg >= bottomAngle && deg <= topAngle ? (
            <g key={`grid-${deg}`}>
              <line
                x1={0}
                x2={w}
                y1={yFor(deg)}
                y2={yFor(deg)}
                stroke="#ffffff"
                strokeOpacity={0.05}
                strokeDasharray="2 6"
              />
              <text x={8} y={yFor(deg) - 4} fontSize={8} fill="#46586f">
                +{deg}°
              </text>
            </g>
          ) : null
        )}

        <line x1={0} x2={w} y1={horizonY} y2={horizonY} stroke="#7dd3fc" strokeOpacity={0.28} strokeDasharray="1 5" />
        <text x={w - 12} y={horizonY - 7} textAnchor="end" fontSize={8.5} fill="#4f637d">
          horizon
        </text>

        {visible.slice(0, 240).map(({ peak, rel }) => {
          const x = xFor(rel);
          const y = yFor(peak.angle);
          const isSelected = peak.id === selectedId;
          const showStem = isSelected || labelledIds.has(peak.id);
          return (
            <g key={peak.id}>
              {showStem ? (
                <line
                  x1={x}
                  y1={horizonY}
                  x2={x}
                  y2={y}
                  stroke={isSelected ? '#7dd3fc' : '#f6b73c'}
                  strokeOpacity={isSelected ? 0.6 : 0.28}
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
                <circle cx={x} cy={y} r={16} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 5.2 : 2.7}
                  fill={isSelected ? '#7dd3fc' : '#f6b73c'}
                  fillOpacity={isSelected || showStem ? 1 : 0.75}
                  stroke="#080e18"
                  strokeWidth={isSelected ? 1.5 : 1}
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
            stroke="#050a12"
            strokeWidth={2.5}
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

        {headingRel != null && Math.abs(headingRel) <= FOV / 2 ? (
          <g>
            <line
              x1={xFor(headingRel)}
              x2={xFor(headingRel)}
              y1={plotTop - 4}
              y2={plotBottom + 8}
              stroke="#f6b73c"
              strokeOpacity={0.4}
              strokeWidth={1.5}
            />
            <path
              d={`M ${xFor(headingRel) - 5} ${plotTop - 12} L ${xFor(headingRel) + 5} ${plotTop - 12} L ${xFor(
                headingRel
              )} ${plotTop - 4} Z`}
              fill="#f6b73c"
            />
          </g>
        ) : null}

        {ticks.map((tick) => (
          <g key={`tick-${tick.bearing}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={plotBottom + 14}
              y2={plotBottom + (tick.major ? 24 : 19)}
              stroke="#3b4c66"
              strokeWidth={1}
            />
            {tick.x > 16 && tick.x < w - 16 ? (
              <text
                x={tick.x}
                y={plotBottom + 38}
                textAnchor="middle"
                fontSize={10}
                fill={tick.major ? '#b9c8dc' : '#6d7f99'}
              >
                {Math.round(tick.bearing)}
              </text>
            ) : null}
            {tick.bearing % 90 === 0 && tick.x > 16 && tick.x < w - 16 ? (
              <text x={tick.x} y={plotBottom + 56} textAnchor="middle" fontSize={11} fontWeight={700} fill="#f6b73c">
                {cardinal(tick.bearing)}
              </text>
            ) : null}
          </g>
        ))}

        <line x1={w / 2} x2={w / 2} y1={plotTop - 18} y2={plotTop + 6} stroke="#f6b73c" strokeWidth={2} opacity={0.8} />
      </svg>

      <div className="panorama-top">
        <div className="panorama-heading">
          <span className="deg">{Math.round(viewBearing)}°</span>
          <span className="card">{cardinal(viewBearing)}</span>
        </div>
        <div className="panorama-meta">
          <span>{visible.length} peaks</span>
          <span className="dot">·</span>
          <span>{radiusKm} km</span>
        </div>
        <button className={`lock-btn ${follow ? 'on' : ''}`} onClick={() => onFollowChange(!follow)}>
          {follow ? 'Locked' : 'Free'}
        </button>
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
