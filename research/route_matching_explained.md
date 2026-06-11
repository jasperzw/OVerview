# Route matching — how it works

This document explains the full pipeline from a raw CSV trip to a rendered polyline on the map.

All matching logic lives in `web_extension/dashboard/matching.js` (`window.OVMatch` in the
browser, `module.exports` in Node). `dashboard/app.js` only loads data and renders.
`scripts/test_route_matching.js` replays cached trips through the exact same code.

---

## 0. Journey merging (`mergeJourneys`)

The OV-chipkaart CSV emits **two rows per journey**:

| Row | txType | from | to | checkIn | checkOut |
|---|---|---|---|---|---|
| 1 | Check-in | Eindhoven Centraal | *(empty)* | 14:21 | |
| 2 | Check-out | Eindhoven Centraal | 's-Hertogenbosch | *(empty)* | 14:55 |

`mergeJourneys` folds the check-in time of row 1 into row 2 (matched on card +
normalised stop + date, with a previous-day fallback for overnight journeys).
Without this no journey row has a check-in time and GTFS departure matching can
never fire. Check-ins that never met a check-out are kept as-is (no destination
to draw). Merging happens once at dashboard load.

---

## 1. Operator inference (`inferOperator`)

Scans **product + txType only** (stop names produced junk: "Bor**ns**esteeg" → NS,
"Arbo**ret**umlaan" → RET), with word boundaries on the short brand names.
The result is cosmetic (colour/label); it no longer narrows route pools.
`refreshTripInference` recomputes it at dashboard load, so cached trips from
older extension versions are corrected too.

## 2. Mode detection (`detectModes`)

The strongest signal is the **stop-name shape**: bus/tram/metro stops are written
`"City, Stop name"` in the CSV while train stations are bare names ("Eindhoven Centraal").

1. Both names contain a comma → `[BUS, TRAM, METRO]`
2. Product names train ("Reizen op Rekening Trein", intercity/sprinter) → `[TRAIN]`
3. Product names exactly one of bus/tram/metro → that mode
   ("Reizen op Rekening Bus Tram Metro" names three and decides nothing)
4. Otherwise → `[TRAIN]`

A wrong guess is recoverable (step 5).

---

## 3. Stop resolution (`resolveJourneyStops`)

`stops.json` (27,866 entries: original set + everything from GTFS-NL `stops.txt`
via `scripts/augment_stops.py`) is keyed by normalised name:

- lowercase, apostrophes stripped (`'s-Hertogenbosch` → `s-hertogenbosch …`)
- platform suffixes dropped: `[ B ]`, `[A]`, `(Perron A3)`
- abbreviations expanded: `Burg.` → `burgemeester`, etc.
- variants tried: bare ↔ `… centraal`, `… cs`, trailing platform letter (`Station Ede-Wageningen I`)

**Journey-aware disambiguation:** names without a city prefix ("Zuidplein",
"Stadhuis" — RET metro stops) are matched against every `"city, name"` key, and
the candidate **pair with the smallest mutual distance** wins. ("Stadhuis" alone
would otherwise resolve to Zoetermeer while the journey is in Rotterdam.)

---

## 4. GTFS schedule match — trains (`findGtfsMatch`)

`schedules.json` (NS only, weekday-bitmask patterns) is searched for departures
from the journey's departure station:

- **Time**: departure between check-in −2 min and +20 min; the first departure
  at/after check-in ranks best (you check in *before* the train leaves).
- **Type**: Intercity/Sprinter from product text when present, else all NS types.
- **Weekday**: 7-bit pattern mask (bit 0 = Mon) — works for historical trips
  because NS timetables repeat weekly.
- **Direction**: GTFS shapes run in travel order, so the departure stop must
  project **earlier on the shape** than the destination. This separates the
  17:51 towards the destination from the 17:51 going the other way.

If a departure's shape covers both stops it provides the geometry (clipped
between the projected endpoints) and the popup text
*"waarschijnlijk de HH:MM TYPE richting HEADSIGN"*. For transfer journeys the
shape ends at the transfer station; the departure whose shape travels *towards*
the destination is still reported for the popup, with geometry left to step 5/6.

---

## 5. Line geometry match (`findRouteGeometry`)

`routes.json` (8,771 lijnnetkaart geometries: TRAIN + TRAM + METRO + **BUS**,
all NL operators) is pooled **by mode across all operators** — operator
inference is too unreliable to narrow with; proximity does the disambiguation.

Scoring per candidate route:

- Distance is point-to-**segment** (not vertex — simplified polylines have
  km-long segments), in degree space with NL longitude correction (×0.629).
- Both stops must be within `MAX_DSQ` = 0.002 (~5 km); score = sum of the two
  squared distances; lowest wins.
- The winner is clipped between the two *projected* points (no overshoot past
  the stops).

**Quality gate:** a match is only trusted outright when both stops are within
~800 m of the line (`GOOD_DSQ` = 5e-5). A merely tolerated match usually means
the mode guess was wrong — Den Haag tram stops are written without a city
prefix, look like train stations and would shadow the actual tram line with a
far-off intercity track — so all other modes then compete on score.

## 6. Rail-network path — transfer journeys (`findRailPath`)

Check-in Eindhoven, check-out Nijmegen: no single line covers that. All TRAIN
geometries are merged into one graph (points within ~60 m snap to shared nodes,
consecutive points become edges; built lazily, cached) and A* finds the actual
track path, transfers included. The rail path also competes with a poor
single-line match (same quality gate).

## 7. Fallback: straight dashed line

Only when every source fails. The Routes debug tab shows `rechte lijn`.
`rondrit` (check-in = check-out stop) has no drawable route by definition and
shows as a dot.

---

## 8. Testing

```bash
node scripts/test_route_matching.js [trips.json] [--verbose]
```

Replays a trips dump (array, or `{trips: […]}` as decoded from
`chrome.storage.local`) through the pipeline and reports per-result counts,
failures, and a geometry sanity check (matched line length vs crow-flies
distance, endpoint gaps). Status on the 406-row reference dump (2026-06-11):
**189/189 drawable journeys get a real geometric route** (117 line, 72 GTFS),
8 rondrit, 0 straight lines, 0 missing stops.
