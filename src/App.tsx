import { useEffect, useMemo, useState } from 'react';
import MapView from './components/MapView';
import Panorama from './components/Panorama';
import PeakList from './components/PeakList';
import SettingsSheet from './components/SettingsSheet';
import { insideRegion, loadData, rankPeaks, type Peak, type RegionMeta } from './data';
import { normalize360, type PeakView } from './geo';
import { DEMO_SITES, loadSettings, saveSettings, type Settings } from './settings';
import { useGeolocation } from './hooks/useGeolocation';
import { useHeading } from './hooks/useHeading';

type Tab = 'aim' | 'map' | 'list';

const params = new URLSearchParams(window.location.search);
const forcedDemo = params.get('demo');
const tabParam = params.get('tab');
const initialTab: Tab = tabParam === 'map' || tabParam === 'list' ? tabParam : 'aim';

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const base = loadSettings();
    if (!forcedDemo) return base;
    return {
      ...base,
      demo: true,
      demoSite: forcedDemo !== '1' && DEMO_SITES.some((site) => site.id === forcedDemo) ? forcedDemo : base.demoSite
    };
  });
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewBearing, setViewBearing] = useState(0);
  const [manualHeading, setManualHeading] = useState(35);

  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [meta, setMeta] = useState<RegionMeta | null>(null);
  const [dataState, setDataState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dataError, setDataError] = useState<string | null>(null);

  const demoMode = settings.demo;
  const demoSite = DEMO_SITES.find((site) => site.id === settings.demoSite) ?? DEMO_SITES[0];

  const live = useGeolocation(!demoMode);
  const sensor = useHeading(!demoMode);

  const fix = useMemo(() => {
    if (demoMode) {
      return {
        lat: demoSite.lat,
        lon: demoSite.lon,
        accuracy: 4,
        altitude: demoSite.alt as number | null,
        altitudeAccuracy: 4,
        at: Date.now()
      };
    }
    return live.fix;
  }, [demoMode, demoSite, live.fix]);

  const useManual = demoMode || sensor.heading == null;
  const heading = useManual ? manualHeading : normalize360((sensor.heading ?? 0) + settings.headingOffset);

  const eyeAlt = settings.altitudeOverride ?? fix?.altitude ?? 0;
  const altitudeKnown = settings.altitudeOverride != null || fix?.altitude != null;
  const qLat = fix ? Math.round(fix.lat * 1e4) / 1e4 : null;
  const qLon = fix ? Math.round(fix.lon * 1e4) / 1e4 : null;
  const qAlt = Math.round(eyeAlt);

  const ranked = useMemo<PeakView[]>(() => {
    if (qLat == null || qLon == null) return [];
    return rankPeaks(peaks, { lat: qLat, lon: qLon }, qAlt, settings.radiusKm);
  }, [peaks, qLat, qLon, qAlt, settings.radiusKm]);

  const outsideRegion = fix ? !insideRegion(meta?.bbox, fix) : false;

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((result) => {
        if (cancelled) return;
        setPeaks(result.peaks);
        setMeta(result.meta);
        setDataState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDataError(error instanceof Error ? error.message : String(error));
        setDataState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (settings.follow) setViewBearing(heading);
  }, [heading, settings.follow]);

  const patchSettings = (patch: Partial<Settings>) => setSettings((current) => ({ ...current, ...patch }));

  const enableDemo = () => {
    patchSettings({ demo: true });
    setSelectedId(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path d="M2.5 19.5 9 6.5l3.6 7.2 2.1-3.4 6.8 9.2H2.5Z" fill="currentColor" />
          </svg>
          <span>Peak Finder</span>
        </div>
        <div className="chips">
          {demoMode ? <span className="chip demo">demo</span> : null}
          {dataState === 'loading' ? <span className="chip">loading</span> : null}
          {fix ? (
            <span className={`chip ${fix.accuracy <= 30 ? 'ok' : 'warn'}`}>{Math.round(fix.accuracy)} m</span>
          ) : (
            <span className="chip warn">no fix</span>
          )}
          {fix ? <span className="chip">{Math.round(eyeAlt)} m</span> : null}
        </div>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.4 8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </button>
      </header>

      <main>
        <section className={`view ${tab === 'aim' ? 'active' : ''}`} aria-hidden={tab !== 'aim'} inert={tab !== 'aim'}>
          <Panorama
            peaks={ranked}
            viewBearing={viewBearing}
            onViewBearing={setViewBearing}
            follow={settings.follow}
            onFollowChange={(follow) => patchSettings({ follow })}
            heading={heading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            radiusKm={settings.radiusKm}
            altitudeKnown={altitudeKnown}
          />
        </section>

        <section className={`view ${tab === 'map' ? 'active' : ''}`} aria-hidden={tab !== 'map'} inert={tab !== 'map'}>
          <MapView
            fix={fix}
            peaks={ranked}
            heading={heading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            layer={settings.tileLayer}
            active={tab === 'map'}
          />
        </section>

        <section className={`view ${tab === 'list' ? 'active' : ''}`} aria-hidden={tab !== 'list'} inert={tab !== 'list'}>
          <PeakList
            peaks={ranked}
            heading={heading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            radiusKm={settings.radiusKm}
          />
        </section>

        {outsideRegion ? (
          <div className="banner warn-banner">
            Your position is outside the extracted peak region ({meta?.name ?? 'unknown'}). You can still see peaks nearby
            in this dataset, but coverage is incomplete.
          </div>
        ) : null}

        {dataState === 'error' ? (
          <div className="banner error-banner">Peak data failed to load. {dataError}</div>
        ) : null}
      </main>

      {useManual ? (
        <div className="heading-bar">
          <span className="heading-label">Heading</span>
          <input
            type="range"
            min={0}
            max={359}
            value={manualHeading}
            onChange={(event) => setManualHeading(Number(event.target.value))}
            aria-label="Manual heading"
          />
          <span className="heading-value">{Math.round(manualHeading)}°</span>
        </div>
      ) : null}

      <nav className="tabbar">
        <button className={tab === 'aim' ? 'on' : ''} onClick={() => setTab('aim')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          <span>Aim</span>
        </button>
        <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z" />
            <path d="M9 4v14M15 6v14" />
          </svg>
          <span>Map</span>
        </button>
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeLinecap="round" />
          </svg>
          <span>Peaks</span>
        </button>
      </nav>

      {!fix ? (
        <div className="gate">
          <div className="gate-card">
            {live.status === 'error' || live.status === 'unsupported' ? null : <div className="spinner" />}
            <h2>
              {live.status === 'error' || live.status === 'unsupported'
                ? 'Location unavailable'
                : 'Finding your position'}
            </h2>
            <p>
              {live.status === 'error'
                ? live.error ?? 'Allow location access for this site and try again.'
                : live.status === 'unsupported'
                  ? 'This browser cannot report your position.'
                  : 'Peak Finder needs your position to work out what you are looking at.'}
            </p>
            <button className="primary" onClick={enableDemo}>
              Try a demo location
            </button>
            {live.status === 'locating' ? (
              <button className="secondary" onClick={() => window.location.reload()}>
                Retry
              </button>
            ) : null}
            <p className="fineprint">Location is used on this device only. Nothing is sent anywhere.</p>
          </div>
        </div>
      ) : null}

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        onChange={patchSettings}
        onClose={() => setSettingsOpen(false)}
        meta={meta}
        altitudeKnown={altitudeKnown}
        eyeAltitude={eyeAlt}
      />
    </div>
  );
}
