# Plan: GTFS trip schedule lookup

**Goal:** show "likely the 08:32 Intercity 3500" in the popup by matching a historical trip against GTFS timetable data.

---

## Data source

`https://gtfs.ovapi.nl/nl/gtfs-nl.zip` (~206 MB compressed, updated daily)

Relevant files inside the zip:

| File             | Size  | What it contains                                      |
|------------------|-------|-------------------------------------------------------|
| `stop_times.txt` | large | departure_time per stop per trip_id                   |
| `trips.txt`      | large | trip_id → route_id, service_id, trip_headsign         |
| `routes.txt`     | small | route_id → route_short_name, route_type, agency_id    |
| `calendar.txt`   | small | service_id → days-of-week + start/end date            |
| `calendar_dates.txt` | medium | exceptions (added/removed service days)           |
| `stops.txt`      | medium | stop_id → stop_name, stop_lat, stop_lon               |

We do **not** need `shapes.txt` (we already have route geometry from lijnnetkaart).

---

## Processing script: `scripts/build_trip_schedules.py`

**Input:** `gtfs-nl.zip` (download once, re-run when timetable changes)

**Output:** `web_extension/data/schedules.json` (~5–15 MB estimated, depending on compression)

### Algorithm

1. **Parse `stops.txt`** → dict `stop_id → (name, lat, lon)`.

2. **Parse `routes.txt`** → dict `route_id → {short_name, type}`. Filter to `route_type` 2 (rail) + 0 (tram) + 1 (metro) — matches lijnnetkaart scope.

3. **Parse `calendar.txt` + `calendar_dates.txt`** → for each `service_id`, compute the set of ISO dates it runs. Store as a sorted list of date strings.

4. **Parse `trips.txt`** → dict `trip_id → {route_id, service_id, headsign}`.

5. **Parse `stop_times.txt`** → group by `trip_id`. For each trip, keep only the **first** and **last** stop (origin/destination stop_id + departure/arrival time).

6. **Build output structure:**
   ```
   schedules[routeShortName][fromStopName][toStopName] = [
     { dep: "08:32", arr: "09:14", dates: ["2025-01-06", "2025-01-07", …] },
     …
   ]
   ```
   Key by `routeShortName` (e.g. "Intercity", "Sprinter", "12") to match `extractPublicCode`.

7. Deduplicate: group trips with identical dep/arr/days pattern.

8. Write `schedules.json`.

### Size concern

The raw GTFS has hundreds of thousands of trips. After filtering to rail/tram/metro and keeping only first+last stop, this should compress to a manageable size. If still too large, restrict to NS rail only (~20k trips) for a first version.

---

## Extension changes

### Load `schedules.json` in app.js

```javascript
let SCHEDULES = null;
async function loadSchedules() {
  const url = chrome.runtime.getURL('data/schedules.json');
  SCHEDULES = await fetch(url).then(r => r.json());
}
// Add to Promise.all in init()
```

### Lookup in `buildPopup`

```javascript
function findLikelyDeparture(trip, routeCoords) {
  if (!SCHEDULES || !trip.checkIn) return null;
  const pc = extractPublicCode(trip.product);        // "Intercity", "Sprinter", …
  const byRoute = SCHEDULES[pc];
  if (!byRoute) return null;
  const byFrom = byRoute[trip.from];
  if (!byFrom) return null;
  const candidates = byFrom[trip.to];
  if (!candidates) return null;

  // Filter to service date + ±5 min around check-in time
  const checkInMins = timeToMins(trip.checkIn);
  return candidates
    .filter(c => c.dates.includes(trip.date))
    .filter(c => Math.abs(timeToMins(c.dep) - checkInMins) <= 5)
    .sort((a, b) => Math.abs(timeToMins(a.dep) - checkInMins)
                  - Math.abs(timeToMins(b.dep) - checkInMins))[0] ?? null;
}
```

In `buildPopup`, if a match is found:
```
"waarschijnlijk de 08:32 Intercity (aankomst ~09:14)"
```

### manifest.json

Add `data/schedules.json` to `web_accessible_resources`.

---

## Key decisions to make before implementing

1. **Scope**: NS trains only first, or include GVB/RET/HTM tram+metro too?
2. **Date range**: keep all dates in GTFS (~1 year forward) or filter to a rolling window? Historical trips outside the window can only be matched by time-of-day pattern.
3. **Size budget**: the extension zip has no hard limit for local loading, but `schedules.json` should stay under ~10 MB to keep load time fast.
4. **Fallback**: when no GTFS match is found (old trip outside GTFS window, stop name mismatch), silently omit the "likely the…" line rather than showing uncertain guesses.

---

## To activate

Just say the word and the build script + extension changes will be implemented.
