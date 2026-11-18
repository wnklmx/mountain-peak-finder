import { useMemo, useState } from 'react';
import { cardinal, formatDistance, formatElevation, normalize180, type PeakView } from '../geo';

type SortKey = 'distance' | 'bearing' | 'elevation';

interface Props {
  peaks: PeakView[];
  heading: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onStandOn: (peak: PeakView) => void;
  radiusKm: number;
  hidden: Set<number>;
}

export default function PeakList({ peaks, heading, selectedId, onSelect, onStandOn, radiusKm, hidden }: Props) {
  const [sort, setSort] = useState<SortKey>('distance');
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => {
    const filtered = query.trim()
      ? peaks.filter((peak) => peak.name.toLowerCase().includes(query.trim().toLowerCase()))
      : peaks;
    const copy = [...filtered];
    if (sort === 'distance') copy.sort((a, b) => a.distance - b.distance);
    else if (sort === 'elevation') copy.sort((a, b) => b.ele - a.ele);
    else copy.sort((a, b) => a.bearing - b.bearing);
    return copy.slice(0, 300);
  }, [peaks, sort, query]);

  const selected = selectedId != null ? peaks.find((peak) => peak.id === selectedId) ?? null : null;
  const turn = selected && heading != null ? normalize180(selected.bearing - heading) : null;

  return (
    <div className="list-view">
      <div className="list-tools">
        <input
          className="search"
          type="search"
          placeholder="Search peaks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="sort-group">
          {(
            [
              ['distance', 'Near'],
              ['bearing', 'Bearing'],
              ['elevation', 'High']
            ] as Array<[SortKey, string]>
          ).map(([key, label]) => (
            <button key={key} className={`sort-btn ${sort === key ? 'on' : ''}`} onClick={() => setSort(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No peaks within {radiusKm} km.</p>
          <p className="muted">Try a bigger radius in settings.</p>
        </div>
      ) : (
        <div className="rows">
          {sorted.map((peak) => {
            const isSelected = peak.id === selectedId;
            const isHidden = hidden.has(peak.id);
            const relative = heading != null ? normalize180(peak.bearing - heading) : normalize180(peak.bearing);
            return (
              <button
                key={peak.id}
                className={`peak-row ${isSelected ? 'selected' : ''} ${isHidden ? 'behind' : ''}`}
                onClick={() => onSelect(isSelected ? null : peak.id)}
              >
                <span className="dir-arrow" style={{ transform: `rotate(${relative}deg)` }} aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 20V5M6 11l6-6 6 6" />
                  </svg>
                </span>
                <span className="peak-main">
                  <span className="peak-name">
                    {peak.name}
                    {isHidden ? <span className="behind-tag">behind ridge</span> : null}
                  </span>
                  <span className="peak-meta">
                    {formatElevation(peak.ele)} · {formatDistance(peak.distance)} · {Math.round(peak.bearing)}°{' '}
                    {cardinal(peak.bearing)}
                  </span>
                </span>
                <span className="peak-angle">
                  {peak.angle >= 0 ? '+' : ''}
                  {peak.angle.toFixed(1)}°
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="list-detail">
          <div className="detail-head">
            <span className="detail-name">{selected.name}</span>
            <button className="detail-close" onClick={() => onSelect(null)} aria-label="Close">
              ×
            </button>
          </div>
          <p className="detail-line">
            {formatElevation(selected.ele)} · {formatDistance(selected.distance)} away · {Math.round(selected.bearing)}°{' '}
            {cardinal(selected.bearing)}
          </p>
          {turn != null ? (
            <p className="turn-line">
              {Math.abs(turn) < 4
                ? 'Straight ahead'
                : `Turn ${Math.abs(Math.round(turn))}° ${turn > 0 ? 'right' : 'left'}`}
            </p>
          ) : (
            <p className="turn-line muted">Enable the compass to get turn-by-turn directions.</p>
          )}
          <button className="detail-action" onClick={() => onStandOn(selected)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 21s6.5-6.2 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.8 12 21 12 21Z" />
              <circle cx="12" cy="10.5" r="2.2" />
            </svg>
            View from here
          </button>
        </div>
      ) : null}
    </div>
  );
}
