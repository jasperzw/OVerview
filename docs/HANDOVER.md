# OVerzicht – Session Handover

Last updated: 2026-06-11 (route matching overhaul)  
Current state: **working end-to-end; every drawable cached journey matches a real geometric route**

---

## What this project is

A Firefox/Chrome browser extension (Manifest V3) that:
1. Injects a "🗺 OVerzicht" button next to each OV-chipkaart card name on ov-chipkaart.nl
2. On click: fetches up to 1 year of travel history via the site's own backend API
3. Parses the resulting CSV and stores it in `chrome.storage.local`
4. Opens a new tab with a Leaflet/CARTO dashboard showing routes as polylines + a trips table

---

## Auth mechanism (solved)

The backend at `https://www.ov-chipkaart.nl/backend/moc` requires `Authorization: Bearer <token>`.

**How we get the token:**
- `manifest.json` runs the content script at `document_start`
- `xhr_logger.js` is injected immediately, patching `window.XMLHttpRequest` and `window.fetch` before Angular boots
- Angular's own page-load requests to `/backend/` are intercepted; the `Authorization` header is extracted and saved to:
  - `window.__overzichtCapturedHeaders` (in-memory, used by `api_bridge.js`)
  - `sessionStorage.__overzicht_auth` (persists across SPA navigations, 1h TTL)
- `api_bridge.js` reads from both sources and replays the header on all our requests

**If requests return 471 (link11 WAF block):** the Bearer token has expired. Reload the ov-chipkaart.nl page to re-authenticate — Angular will re-fetch and `xhr_logger` will capture the fresh token.

---

## API endpoints

All under `https://www.ov-chipkaart.nl/backend/moc`.

| Method | Path | Notes |
|---|---|---|
| GET | `/cards/retrieve` | Returns `{ cards: [{ alias, mediumId, hashedMediumId }] }` |
| GET | `/cards/retrievedetails?hashedMediumId=<id>` | Returns `cardStatus.expiryDate` |
| POST | `/cardtravelhistory/cardtransactions` | Body: `{ mediumId, expiryDate, dateFilter:{start,end}, transactionKindFilter:null }`. Max 30-day window. |
| POST | `/cardtravelhistory/generatedocument` | Body: adds `documentFormat:"COMMA_SEPARATED_VALUE"` and `selectedTransactions`. Returns base64 CSV. |

CSV columns (English): `Date;Check-in;Departure;Check-out;Destination;Amount;Transaction;Class;Product;Comments;Name;Card number`

---

## File structure

```
web_extension/
├── manifest.json                 MV3, Firefox + Chrome, run_at: document_start
├── scripts/
│   ├── content_script.js         Button injection + API pipeline + CSV parser
│   ├── api_bridge.js             Page-context fetch proxy (same-origin, replays Bearer token)
│   ├── xhr_logger.js             Intercepts Angular requests, captures + persists auth headers
│   └── background.js             Saves trips to storage, opens dashboard tab
├── dashboard/
│   ├── index.html                Tabs: Kaart / Ritten / Routes (debug)
│   ├── matching.js               ALL matching logic (browser global OVMatch / Node module)
│   ├── app.js                    Leaflet map + trips table + rendering (no matching logic)
│   └── style.css
├── popup/
│   └── OVerzicht.html/js/css     Extension popup
├── data/
│   ├── stops.json                27,866 OV stops keyed by normalised name (orig + GTFS-NL)
│   ├── routes.json               8,771 TRAIN/TRAM/METRO/BUS geometries from lijnnetkaart (6.7 MB)
│   └── schedules.json            NS departure index built from GTFS-NL (weekday bitmasks)
└── lib/
    └── leaflet.js / leaflet.css  Bundled locally (MV3 blocks CDN scripts)

scripts/
├── build_route_geometries.py     Builds routes.json from OpenOV lijnnetkaart shapefile
├── build_trip_schedules.py       Builds schedules.json from GTFS-NL zip (NS only)
├── augment_stops.py              Adds missing stops.txt entries from GTFS-NL to stops.json
└── test_route_matching.js        Node harness: replays a trips dump through matching.js

research/
└── route_matching_explained.md   Full documentation of the route matching pipeline
```

---

## Route geometry pipeline

All matching logic lives in **`dashboard/matching.js`** (`window.OVMatch` in the browser,
`module.exports` in Node — the test harness `scripts/test_route_matching.js` replays cached
trips through the identical code). Full documentation: `research/route_matching_explained.md`.

Per journey:

0. **`mergeJourneys`** — the CSV emits separate Check-in and Check-out rows; the check-in
   *time* is folded into the journey row (enables GTFS time matching). Done once at load.
1. **`refreshTripInference`** — recomputes operator (word-boundary keywords on product/txType
   only). `detectModes` picks candidate modes; key heuristic: bus/tram/metro stops are written
   `"City, Stop"`, train stations are bare names.
2. **`resolveJourneyStops`** — normalised lookup in stops.json (platform suffixes stripped,
   abbreviations expanded) with journey-aware disambiguation: ambiguous names resolve to the
   candidate pair with the smallest mutual distance.
3. **`findGtfsMatch`** (NS trains) — departures from schedules.json: check-in −2…+20 min,
   weekday bitmask, direction-aware (departure must project earlier on the GTFS shape than
   the destination). Gives exact shape + "waarschijnlijk de HH:MM …" popup.
4. **`findRouteGeometry`** — lijnnetkaart routes.json pooled by mode across all operators;
   point-to-segment scoring, both stops ≤5 km, clipped at projected endpoints. A match with
   either stop >800 m from the line lets all other modes compete (catches tram stops that
   look like train stations).
5. **`findRailPath`** — transfer journeys (Eindhoven→Nijmegen): A* over a graph built from
   all TRAIN geometries (~60 m node snapping, lazily built).
6. **Straight line** — only when everything fails. `rondrit` (from == to) is just a dot.

---

## GTFS schedule data

**Source:** `https://gtfs.ovapi.nl/nl/gtfs-nl.zip` (~206 MB, near-real-time 4-day window)

**Build script:** `scripts/build_trip_schedules.py`

```bash
python3 scripts/build_trip_schedules.py /path/to/gtfs-nl.zip
```

The script:
- Identifies NS agency IDs and NS rail routes (route_type=2)
- Expands calendar.txt + calendar_dates.txt → 7-bit weekday bitmask per service pattern (not per date — stable year-round for historical matching)
- Streams stop_times.txt → per-stop departure list `{dep, type, headsign, pid, shape}`
- Deduplicates on `(dep, type, headsign, pid, shape)` key
- Streams shapes.txt for NS shapes, applies iterative Douglas-Peucker (ε=0.00027°, ~30m)
- Output: `web_extension/data/schedules.json`

The committed `schedules.json` uses the weekday-bitmask format (built 2026-06-09). Re-run the
build script against a fresh GTFS zip whenever NS timetables change materially.

---

## Routes debug tab

The **Routes** tab (third tab in dashboard) shows per-trip route-matching diagnostics.

Columns: Datum, Check-in, Check-out, Van, Naar, Vervoerder, Product (CSV), Stop van, Stop naar, Pool, Code, Gefilterd, GTFS vertrek, Beste match, Score, Van idx, Naar idx, Punten, Resultaat.

Column headers are resizable by dragging their right edges (`resize: horizontal` on `th` with `table-layout: fixed`).

The **GTFS vertrek** column shows the matched departure (e.g. `08:32 Intercity`) when `findLikelyDeparture` succeeds. If it's empty for NS trips after rebuilding schedules.json, check the weekday pattern bitmask covers the trip's day of week.

---

## What works

| Component | Status |
|---|---|
| Extension loads in Firefox | ✅ |
| Button injection on card list | ✅ |
| Auth token capture via xhr_logger | ✅ |
| Full API pipeline (cards → details → CSV) | ✅ |
| CSV parsing (English columns) | ✅ |
| Dashboard map with CARTO tiles | ✅ |
| Dashboard trips table with filters | ✅ |
| Preset filter buttons (week/month/3mo/year) | ✅ |
| OpenRailwayMap overlay | ✅ |
| Route geometry from lijnnetkaart incl. BUS (routes.json) | ✅ |
| Operator/mode inference (comma heuristic, word boundaries) | ✅ |
| Check-in/check-out row merging | ✅ |
| Journey-aware ambiguous stop resolution | ✅ |
| Rail-network A* for transfer journeys | ✅ |
| Routes debug tab with per-trip diagnostics | ✅ |
| Resizable debug table columns | ✅ |
| GTFS schedule lookup + "waarschijnlijk" popup (direction-aware) | ✅ |
| GTFS shape geometry for matched trips | ✅ |
| Node test harness over cached trips | ✅ (`scripts/test_route_matching.js`) |

Reference run (406 cached rows, 2026-06-11): **189/189 drawable journeys get a real
geometric route** (117 line match, 72 GTFS match), 8 rondrit (from == to, nothing to
draw), 0 straight lines, 0 missing stops.

---

## Known issues / backlog

- Bus journeys with a *transfer* would need a road-network graph like the rail one
  (none occur in the data: bus check-in/out happens per vehicle)
- The lijnnetkaart is a current snapshot — lines that were rerouted/discontinued since a
  historical trip may match a slightly different geometry, or none
- Fetches ALL cards on every button click; could scope to the clicked card
- Distribution packaging (zip for Firefox/Chrome Web Store)

---

## DOM selectors (may break on site updates)

`span.z02f8dvw` inside `li.sga5ez2` — minified/hashed classnames that change on deploys.
