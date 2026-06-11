# OVerzicht – Session Handover

Last updated: 2026-06-11 (statistics tabs + heatmap + timeline + coverage scratch map + Treinen)  
Current state: **working end-to-end; every drawable cached journey matches a real geometric route;
dashboard has 7 tabs (Kaart / Ritten / Statistieken / Kosten / Gewoontes / Treinen / Routes),
heatmap + dekking overlays and an animated timeline on the map**

---

## What this project is

A Firefox/Chrome browser extension (Manifest V3) that:
1. Injects a "🗺 OVerzicht" button next to each OV-chipkaart card name on ov-chipkaart.nl
2. On click: fetches up to 5 years of travel history via the site's own backend API
   (newest-first 30-day chunks; stops walking back after 8 consecutive empty/error chunks
   older than a year (240 days, so a half-year travel gap isn't mistaken for the retention
   limit) — `HISTORY_YEARS` / `MAX_EMPTY_OLD_CHUNKS` in content_script.js — so worst case
   roughly equals the old 1-year scrape)
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
│   ├── index.html                Tabs: Kaart / Ritten / Statistieken / Kosten / Gewoontes / Treinen / Routes (debug)
│   ├── matching.js               ALL matching logic (browser global OVMatch / Node module)
│   ├── stats.js                  Statistics tabs (browser global OVStats / Node module)
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
├── test_route_matching.js        Node harness: replays a trips dump through matching.js
└── test_dashboard_smoke.js       Node harness: app.js render/stats/heatmap/timeline with stubs

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

## Statistics tabs (Statistieken / Kosten / Gewoontes)

All statistics logic lives in **`dashboard/stats.js`** (`window.OVStats`, Node-requirable like
matching.js). While rendering the map, `renderTrips` in app.js collects one record per trip —
`{ trip, latlngs, geometric, isRoundTrip, mode }` — where `latlngs` is the geometry actually
drawn, and hands the list to `OVStats.renderAll`. The date filter therefore applies to the
statistics too. Distances are haversine-summed along the matched polyline; straight-line
fallbacks count as-the-crow-flies (footnoted in the UI).

- **Statistieken** — total km (× length of NL), trip count, total/average travel time, average
  speed; per-mode and per-operator breakdowns; km-per-month bar chart.
- **Kosten** — total spend, average per paid trip, €/km, credits; spend + €/km per operator
  and per mode; top-5 most expensive journeys; monthly spend bars with cumulative total.
  (Subscription what-if analysis from the ideas doc is NOT implemented — needs price tables.)
- **Gewoontes** — day-of-week × hour-of-check-in punch card; busiest route (undirected pair),
  longest streak of consecutive travel days, busiest day; records (earliest/latest check-in,
  longest/farthest trip); top stations by visits (from + to both count).
- **Treinen** — NS-specific, from the GTFS departure findGtfsMatch identified per trip
  (`gtfsDep` on the stats record): IC/Sprinter ratio, average check-in-to-departure dwell
  (−2…+20 min match window, midnight-normalised) with a "reisstijl" persona
  (Perronsprinter ≤3 min / Strak gepland ≤7 / Ruim op tijd), dwell histogram, per-type and
  per-departure-station tables, and "jouw vaste treinen" (same time + type + headsign,
  most-repeated first). Shows an explanatory note when no trips have a GTFS match.

Mode per trip: GTFS match ⇒ TRAIN; otherwise the matched line's mode; otherwise the CSV
heuristic, with 'BTM' when stop-name shape only narrows it to bus/tram/metro.

## Export / import (back-up)

Header buttons in the dashboard. **⬇ Export** downloads storage as
`overzicht-export-YYYY-MM-DD.json`: `{ format: 'overzicht-trips', version: 1, exportedAt,
fetchedAt, trips }` with the raw *unmerged* rows, so re-import behaves like a fresh fetch.
**⬆ Import** accepts that file or a bare trips array, validates (rows need `date` +
`from`/`to`), asks for confirmation, **replaces** `chrome.storage.local` and reloads the
dashboard. Merging an old export with a fresh fetch (dedupe) is not implemented — see
backlog.

## Heatmap overlay

`heatLayer` (layer control: "Heatmap (frequentie)", off by default) is rebuilt on every
`renderTrips`. Identical trip paths are pooled direction-insensitively (`heatKey`: point
count + sorted endpoints, 4-decimal rounding) and every stop visit is counted; colour
(yellow→orange→red ramp), line weight and dot radius scale with log(count). Stop dots
carry a "<naam> — N bezoeken" popup; the heat lines themselves are non-interactive.
Hottest paths are drawn last so they stay on top.

## Coverage scratch map + Netwerkdekking stats

**Map layer** — "Dekking (scratch map)" in the layer control (off by default): the full
TRAIN/TRAM/METRO lijnnetkaart in faint grey with every travelled geometry lit up in amber on
top, plus dots for visited stops. Drawn on a dedicated `L.canvas` renderer (the base network
is thousands of polylines — too many for SVG). Built lazily on the first `overlayadd` and
rebuilt when the rendered trip set changes while the layer is on (`coverageStale` flag).
BUS is excluded from the layer (the full bus network would blanket the country).

**Stats** — `computeCoverage` in stats.js rasterises geometries into ~280 m cells
(`COV_CELL`, lon corrected by cos 51°). A mode's network size = distinct cells its lines
pass through (de-duplicates parallel routes over the same track/street); coverage = the
fraction of those cells the travelled geometries touch, with ±1 cell tolerance because GTFS
shapes and lijnnetkaart lines for the same track are drawn slightly apart. Clipped to an NL
bounding box so international stretches (ICE/IC abroad) don't inflate "het Nederlandse
spoornet" (TRAIN ≈ 3.7k cell-km vs ~9.2k unclipped). Network cell sets are cached for the
session (~180 ms to build, ~4 ms per subsequent call). Shown as the "Netwerkdekking" section
in the Statistieken tab with a headline ("Je hebt ≈X% van het Nederlandse spoornet bereisd")
and a per-mode table; only geometric (matched-route) trips count, straight-line fallbacks
don't.

## Timeline (map tab)

A full-width bar below the map on the Kaart tab (`#timeline`, in flex flow, hidden when no
trips have a parseable date). It shows an **intensity graph** — ritten per dag over the whole
rendered period, drawn as an SVG area+line stretched to the bar width (viewBox = 1 unit per
day, `preserveAspectRatio="none"`, rebuilt in `buildTimelineGraph` on every render). On top
sits a draggable highlight window (`#tl-window`, NS-yellow) whose width is the chosen periode
(week/maand) as a fraction of the period. Click anywhere on the graph to centre the window
there, or drag it (pointer capture keeps the drag alive outside the bar). ▶ sweeps the window
one day per tick across the period; the snelheid select (0,5×/1×/2×/4× → 360/180/90/45 ms per
day, `timeline.msPerDay`) sets the pace and can be changed mid-play. ✕ disengages and shows
everything again.

Implementation: `renderTrips` records `{dayNum, layers:[line, hit, dot]}` per drawn trip in
`tripLayerIndex` (`dayNum` = UTC day number). Moving the window only calls `setStyle` with
target opacities — nothing is re-rendered — and a CSS transition on
`.leaflet-overlay-pane path` (stroke/fill-opacity, 0.45 s) produces the fade in/out. Hidden
trips get `pointer-events: none` on their hit-area and dot elements so their popups can't be
clicked. The header date filter re-renders, which resets the timeline to "Hele periode";
`resetTimeline` calls `map.invalidateSize()` because showing/hiding the bar resizes the map.

Smoke test: `node scripts/test_dashboard_smoke.js` loads app.js with stubbed
Leaflet/DOM/chrome and replays synthetic journeys through render + stats + heatmap +
timeline (prints `SMOKE-OK`).

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
| Statistieken tab (km/time/speed totals + breakdowns) | ✅ |
| Kosten tab (spend, €/km, duurste ritten, maandtrend) | ✅ |
| Gewoontes tab (punch card, streaks, records, top stations) | ✅ |
| Treinen tab (IC/Sprinter-ratio, incheckgedrag, vaste treinen) | ✅ |
| Heatmap-overlay (frequentie van paden + stops, layer control) | ✅ |
| Dekking scratch map (volledig net grijs, bereisd opgelicht) | ✅ |
| Netwerkdekking-statistiek (% spoornet bereisd, per modus) | ✅ |
| Timeline op kaart (intensiteitsgrafiek, sleepbaar venster, play met snelheidskeuze, fades) | ✅ |
| Dashboard smoke harness | ✅ (`scripts/test_dashboard_smoke.js`) |
| 5-jaar scrape met automatische terugval naar wat de backend bewaart | ✅ (ongetest tegen live API) |
| Export/import van reisdata (JSON-back-up) | ✅ |

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
- The 5-year scrape hasn't run against the live API yet — verify the early-stop log
  ("bewaartermijn bereikt") looks sane on a real card
- Import replaces storage; merging an old export with a fresh fetch (dedupe on
  date|checkIn|from|to|card) would let exports extend past the retention window
- Distribution packaging (zip for Firefox/Chrome Web Store)
- Statistics ideas 6–8 (outlier gallery, geographic extremes, transfer analysis) are still
  open — see `docs/STATISTICS_IDEAS.md`; idea 2's subscription what-if needs NS price tables
- Idea 4's "% of network" headline counts the whole NL rail net incl. regional operators;
  could split NS hoofdrailnet vs. regional

---

## DOM selectors (may break on site updates)

`span.z02f8dvw` inside `li.sga5ez2` — minified/hashed classnames that change on deploys.
