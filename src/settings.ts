export interface DemoSite {
  id: string;
  label: string;
  lat: number;
  lon: number;
  alt: number;
}

export const DEMO_SITES: DemoSite[] = [
  { id: 'chamonix', label: 'Chamonix · Mont Blanc', lat: 45.9237, lon: 6.8694, alt: 1035 },
  { id: 'zermatt', label: 'Zermatt · Matterhorn', lat: 46.0207, lon: 7.7491, alt: 1620 },
  { id: 'innsbruck', label: 'Innsbruck', lat: 47.2692, lon: 11.4041, alt: 574 },
  { id: 'berchtesgaden', label: 'Berchtesgaden · Watzmann', lat: 47.6305, lon: 13.0043, alt: 570 },
  { id: 'bolzano', label: 'Bolzano · Dolomites', lat: 46.4983, lon: 11.3548, alt: 262 },
  { id: 'grindelwald', label: 'Grindelwald · Eiger', lat: 46.6242, lon: 8.0414, alt: 1034 }
];

export interface Settings {
  radiusKm: number;
  altitudeOverride: number | null;
  headingOffset: number;
  demo: boolean;
  demoSite: string;
  tileLayer: 'topo' | 'osm';
  follow: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  radiusKm: 120,
  altitudeOverride: null,
  headingOffset: 0,
  demo: false,
  demoSite: 'chamonix',
  tileLayer: 'topo',
  follow: true
};

const KEY = 'peakfinder.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable, ignore */
  }
}
