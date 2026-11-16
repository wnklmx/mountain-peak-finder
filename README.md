# Peak Finder

A PeakFinder-style web app that tells you which mountain peaks you are looking at.
It is a static site: no backend, no accounts, no API keys, no developer account.
Install it from the browser like an app and it keeps working offline.

**Live:** https://wnklmx.github.io/mountain-peak-finder/

![Aim view](docs/aim.jpg)

## What it does today (Phase 0)

- **Aim** – a 90° panorama of every peak around you, placed at its true bearing and
  elevation angle, with drag-to-look and compass lock. Labels never overlap.
- **Map** – terrain map with your position, a field-of-view wedge and every peak as a dot.
- **Peaks** – the list view: distance, bearing, elevation angle, turn-by-turn arrows,
  search and sorting.
- **Demo locations** – Chamonix, Zermatt, Innsbruck, Berchtesgaden, Bolzano, Grindelwald,
  so you can try it anywhere (append `?demo=chamonix` to the URL).
- **PWA** – installable, offline after the first load, auto-updating.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run preview
```

Camera and sensors need HTTPS (or `localhost`). To test on a phone over your LAN, use a
tunnel such as `cloudflared tunnel --url http://localhost:5173`.

## Peak data

`public/data/peaks.geojson` is generated once and committed, so the deployed site has no
runtime dependencies.

```bash
npm run data:peaks-geonames   # default: GeoNames dumps, reliable, CC BY 4.0
npm run data:peaks            # OSM/Overpass, better names, but the public API is often busy
```

Both scripts read a bounding box from env vars and write `peaks.geojson` + `meta.json`:

```bash
WEST=6 SOUTH=45 EAST=10 NORTH=48 REGION_NAME="Switzerland" npm run data:peaks-geonames
```

The committed extract covers the Alps (`5.5 E – 16.5 E`, `43.5 N – 48.2 N`, 23k peaks,
3 MB). Outside it, the app still runs but coverage is thin — regenerate for your region.

## How the angles work

For a peak at elevation `h` and an eye at `h₀`, using local east/north offsets `x, y`:

```
d        = √(x² + y²)
bearing  = atan2(x, y)
angle    = atan( (h − h₀ − d²/(2R′)) / d ),   R′ = R / (1 − 0.13)
```

The `d²/(2R′)` term is earth curvature corrected for standard atmospheric refraction —
785 m over 100 km, so it cannot be skipped. Eye altitude comes from GPS (or the demo site);
a manual override lives in settings.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Once, in the repository:

1. **Settings → Pages → Source: GitHub Actions**
2. Push to `main`.

The Vite `base` is derived from `REPO_NAME` in the workflow, so the project-site path
(`/<repo>/`) works with no editing. For a user site or custom domain, set `REPO_NAME`
accordingly or drop the base override in `vite.config.ts`.

No Play Store, no `$25` fee, no identity verification. The URL is the distribution channel:
open it on Android Chrome and choose **Install app**.

## Project layout

```
src/
  geo.ts                    projection, bearing, elevation angle, formatting
  data.ts                   GeoJSON loading, radius filter, ranking
  hooks/useGeolocation.ts   watchPosition wrapper
  hooks/useHeading.ts       compass + smoothing + iOS permission
  components/Panorama.tsx   the aim view (SVG, label collision, drag)
  components/MapView.tsx    Leaflet map, FOV wedge, peak markers
  components/PeakList.tsx   searchable, sortable list
  components/SettingsSheet.tsx
scripts/
  fetch-peaks-geonames.mjs  GeoNames extractor (default)
  fetch-peaks.mjs           OSM/Overpass extractor
  make-icons.mjs            PNG icon generator (no image deps)
```

## Roadmap

- **Phase 1 – terrain skyline.** Sample AWS Terrain Tiles (Terrarium PNGs) in a Web Worker,
  ray-march a horizon profile, and draw the real silhouette behind the peak dots. This also
  gives a proper visibility test: a peak is only labelled if no ridge blocks the line of sight.
- **Phase 2 – camera AR.** Rear camera as the background, skyline and labels projected with
  a calibrated FOV.
- **Phase 3 – offline areas.** "Download this valley" caches DEM and peak tiles in IndexedDB.

## Attribution

- Peak data: [GeoNames](https://www.geonames.org/) country dumps, **CC BY 4.0**
  (or OpenStreetMap, **ODbL**, if you regenerate with `data:peaks`).
- Map tiles: © OpenStreetMap contributors, style ©
  [OpenTopoMap](https://opentopomap.org) (CC-BY-SA).
- Elevation angles are estimates. Curvature and refraction are corrected; GPS altitude
  and summit elevations are not survey grade. Do not use for navigation.
