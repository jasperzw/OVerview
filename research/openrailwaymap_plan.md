# OpenRailwayMap Integration Plan for OVerzicht

## What OpenRailwayMap offers

Two services, both free and no auth required:

### 1. Tile layers
```
https://tiles.openrailwaymap.org/{style}/{z}/{x}/{y}.png
```
| Style | Shows |
|---|---|
| `standard` | Tracks, stations, switches, tunnels, bridges |
| `signals` | Signals, train protection systems |
| `maxspeed` | Line speed limits (colour-coded) |
| `electrification` | Electrification type and voltage |
| `gauge` | Track gauge |

### 2. REST API — `api.openrailwaymap.org/v2/`

**Facility endpoint** — search railway stations/stops by name, ref, or UIC code:
```
GET /facility?name=Amsterdam+Centraal&limit=1
```
Returns: `lat`, `lon`, `osm_id`, `name`, `uic_ref`, `railway` type, `operator`, `rank`
(rank = importance score based on how many routes pass through the station)

**Milestone endpoint** — locate a point on a line by route ref + km position:
```
GET /milestone?ref=4201&position=18.4
```
Returns: `lat`, `lon`, `position`, `railway` type, `ref`

Rate limit: small personal-scale apps are free; HTTP 429 means back off.
Attribution: "Map data © OpenStreetMap contributors, Map style © OpenRailwayMap"

---

## What this means for OVerzicht

Currently the map draws straight crow-flies lines between station coordinates.
OpenRailwayMap enables three layers of improvement, tackled in phases:

---

## Phase 1 — Railway tile overlay (1–2 hours)

**What**: Add the ORM `standard` tile layer as a toggleable overlay in the Leaflet map.
This shows actual tracks, station symbols, and station names underneath the user's trip lines.

**Why first**: Zero API calls, no rate limit risk, immediate visual improvement.
The user's straight-line trips become clearly anchored to real infrastructure.

**Implementation**:
- Add a second `L.tileLayer` pointing to ORM standard tiles with `opacity: 0.5`
- Add a `L.control.layers` toggle so the user can switch it on/off
- Update attribution string to include ORM + OSM credit

```javascript
const ormLayer = L.tileLayer(
  'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
  { maxZoom: 19, opacity: 0.5,
    attribution: '© <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>' }
);
L.control.layers(
  { 'OSM': osmLayer },
  { 'Spoorwegen': ormLayer }
).addTo(map);
```

**Files changed**: `dashboard/app.js`, `dashboard/style.css`

---

## Phase 2 — ORM as station geocoding fallback (2–3 hours)

**What**: When a trip's departure or destination station is not found in the local
`stops.json` lookup (14,871 Dutch stops from GTFS), fall back to querying the ORM
facility API by name.

**Why**: The mobile API returns station names as free text. Edge cases:
- International stations (Köln, Brussels Midi)
- Unusual name spellings
- Stations added after the last GTFS export

**Implementation**:
- Add `lookupStationRemote(name)` in `dashboard/app.js`
- Cache results in `chrome.storage.local` under `stationCache`
- Rate-limit: one ORM request per unknown station, 500 ms minimum between requests
- On success, store `{ lat, lon, name, uic_ref }` in the cache permanently

```javascript
async function lookupStationRemote(name) {
  const url = `https://api.openrailwaymap.org/v2/facility?name=${encodeURIComponent(name)}&limit=1`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'OVerzicht/0.2' } });
  if (!resp.ok) return null;
  const [result] = await resp.json();
  return result ? { lat: result.latitude, lon: result.longitude, name: result.name } : null;
}
```

Add `https://api.openrailwaymap.org/*` to `host_permissions` in `manifest.json`.

**Files changed**: `dashboard/app.js`, `manifest.json`

---

## Phase 3 — Station enrichment: UIC codes + Wikipedia links (2–3 hours)

**What**: When a station IS found in the local lookup, optionally query ORM for its
`uic_ref`, `wikidata`, and `wikipedia` OSM tags to enrich the popup.

**Why**: Makes the map interactive and informative. Clicking a station node shows:
- Station type (intercitystation, knooppuntstation, stoptreinstation)
- Wikipedia link
- Whether it has wheelchair access, platforms count

**Implementation**:
- Extend the trip popup in `dashboard/app.js` to include an "ℹ" link
- On click: fetch ORM facility data for that station (lazy, only when clicked)
- Show enriched info in a slide-out side panel

**Priority note**: Nice-to-have. Phase 1 and 2 deliver more value per effort.

---

## Phase 4 — Real route geometry on the map (1–2 days)

**What**: Replace straight lines with actual track/road geometry for each trip.

**Why**: A trip from Amsterdam → Utrecht drawn as a straight line crosses the IJ — the
real route goes via Abcoude. Actual geometry is far more accurate and visually correct.

**Two data sources work together here**:

| Source | Use |
|---|---|
| `data.openov.nl/lijnnetkaart/` shapefile | NS/GVB/RET/bus route geometries (updated May 2026) |
| ORM tile overlay (Phase 1) | Visual reference layer |
| ORM milestone endpoint | Pinpoint positions on a line by km |

**Implementation approach**:
1. Convert `lijnnetkaart/20260511.zip` Shapefile → GeoJSON (Python, `pyshp` or `fiona`)
2. Index routes: `{ "NS:Intercity:ASD-UT": [[lat,lon], ...] }`
3. In `background.js`: when pairing check-in/check-out, try to find a matching route
   geometry by operator + line code
4. In `dashboard/app.js`: draw `L.polyline(geometry)` instead of a straight 2-point line
5. Fall back to straight line when no geometry match found

**Challenge**: Matching a user trip ("NS, Amsterdam → Utrecht") to a specific route
geometry requires knowing the line number. The mobile API's `productText` field
("Intercity 3500") may give this. Needs testing with real data.

**Files changed**: `scripts/background.js`, `dashboard/app.js`, new `data/routes.json` (GeoJSON)

---

## Summary table

| Phase | Effort | Visual impact | API calls | Risk |
|---|---|---|---|---|
| 1 — Tile overlay | Low (1–2h) | High | None (tiles) | None |
| 2 — ORM geocode fallback | Medium (2–3h) | Medium | Only on cache miss | Rate limit |
| 3 — Station enrichment | Medium (2–3h) | Low–Medium | On click only | Rate limit |
| 4 — Real route geometry | High (1–2 days) | Very high | None (bundled data) | Complex matching |

**Recommended order**: 1 → 4 → 2 → 3
Phase 4 requires the lijnnetkaart shapefile conversion (offline step, no API calls),
so it carries zero runtime risk. Phase 2 is the only phase that adds live API calls
to the critical path and needs careful rate-limit handling.
