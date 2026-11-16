import { DEMO_SITES, type Settings } from '../settings';
import type { RegionMeta } from '../data';

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  meta: RegionMeta | null;
  altitudeKnown: boolean;
  eyeAltitude: number;
}

export default function SettingsSheet({
  open,
  settings,
  onChange,
  onClose,
  meta,
  altitudeKnown,
  eyeAltitude
}: Props) {
  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Settings</h2>

        <div className="field switch-field">
          <div>
            <span className="field-name">Demo location</span>
            <span className="field-hint">Explore without GPS or leaving the sofa</span>
          </div>
          <button
            className={`switch ${settings.demo ? 'on' : ''}`}
            onClick={() => onChange({ demo: !settings.demo })}
            aria-pressed={settings.demo}
          >
            <span />
          </button>
        </div>

        {settings.demo ? (
          <div className="field">
            <span className="field-name">Demo site</span>
            <select value={settings.demoSite} onChange={(event) => onChange({ demoSite: event.target.value })}>
              {DEMO_SITES.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="field">
          <span className="field-name">
            Search radius <b>{settings.radiusKm} km</b>
          </span>
          <input
            type="range"
            min={20}
            max={300}
            step={10}
            value={settings.radiusKm}
            onChange={(event) => onChange({ radiusKm: Number(event.target.value) })}
          />
        </div>

        <div className="field">
          <span className="field-name">
            Eye altitude{' '}
            <b>
              {settings.altitudeOverride != null
                ? `${Math.round(settings.altitudeOverride)} m`
                : altitudeKnown
                  ? `auto · ${Math.round(eyeAltitude)} m`
                  : 'unknown'}
            </b>
          </span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Automatic from GPS"
            value={settings.altitudeOverride ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              onChange({ altitudeOverride: raw === '' ? null : Number(raw) });
            }}
          />
          <span className="field-hint">Leave empty to use the altitude reported by GPS.</span>
        </div>

        <div className="field">
          <span className="field-name">
            Compass offset <b>{settings.headingOffset > 0 ? '+' : ''}{settings.headingOffset}°</b>
          </span>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={settings.headingOffset}
            onChange={(event) => onChange({ headingOffset: Number(event.target.value) })}
          />
          <span className="field-hint">Use this if the compass consistently points a little off.</span>
        </div>

        <div className="field">
          <span className="field-name">Map style</span>
          <div className="segmented">
            <button
              className={settings.tileLayer === 'topo' ? 'on' : ''}
              onClick={() => onChange({ tileLayer: 'topo' })}
            >
              Terrain
            </button>
            <button
              className={settings.tileLayer === 'osm' ? 'on' : ''}
              onClick={() => onChange({ tileLayer: 'osm' })}
            >
              Standard
            </button>
          </div>
        </div>

        <div className="about">
          <div className="about-title">Data</div>
          {meta ? (
            <p>
              {meta.count.toLocaleString('en-US')} peaks · {meta.name} · extracted{' '}
              {new Date(meta.generated).toLocaleDateString()}
            </p>
          ) : (
            <p>Peak data not loaded yet.</p>
          )}
          <p className="muted">
            {meta?.attribution ?? 'Peak data © their respective authors.'}
            {meta?.license ? ` · ${meta.license}` : ''}
          </p>
          <p className="muted">Map tiles © OpenStreetMap contributors, OpenTopoMap (CC-BY-SA).</p>
        </div>

        <button className="primary close-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
