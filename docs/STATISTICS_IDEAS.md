# Statistics ideas

> Status (2026-06-11): ideas 1–3 are implemented as the dashboard tabs
> **Statistieken**, **Kosten** and **Gewoontes** (`dashboard/stats.js`), except
> the subscription what-if analysis in idea 2, which needs NS price tables.
> Idea 4 is fully implemented: the frequency **heatmap overlay** on the map tab
> (paths and stops glow hotter with use), the **"Dekking (scratch map)"** layer
> (full rail network in grey, travelled parts lit up, visited stops dotted),
> and the **Netwerkdekking** section in the Statistieken tab ("Je hebt ≈X% van
> het Nederlandse spoornet bereisd" + per-mode table). The map also gained a
> timeline bar (intensity graph, draggable week/month window, play sweep with
> speed control and fades), which wasn't in this list.
> Idea 5 is implemented as the **Treinen** tab: IC/Sprinter ratio, average
> check-in-before-departure dwell with a "reisstijl" persona, dwell histogram,
> per-type and per-station tables, and your most-repeated trains.

Ideas for statistics that can be derived from the cached travel history, roughly
ordered by implementation effort. The data per journey is richer than the raw CSV:
date, check-in/check-out times, origin/destination stops, cost, class, product,
inferred operator and mode, the actual route geometry (real distances, not straight
lines), and for NS trips the likely specific departure (time + Intercity/Sprinter
type) from GTFS.

Ideas 1–3 need no new data — they're aggregations over what's already in
`chrome.storage.local` after a fetch, and would fit naturally as a fourth
"Statistieken" tab in the dashboard. Idea 4 is the most visually striking and reuses
the existing Leaflet map. Idea 5 is the most unique — almost no other tool can tell
you which actual train you probably took.

## 1. Distance & "Spotify Wrapped" totals

Since every journey has a real polyline, sum geometric kilometres travelled per mode
(train/tram/metro/bus), per operator, per month. Fun derived facts:

- "You travelled 2.3× the length of the Netherlands"
- Total hours spent in transit (check-out minus check-in)
- Average speed per trip — also a nice sanity check that a route matched correctly

## 2. Cost analytics

- €/km per mode and per operator (trains vs. that one expensive bus line)
- Monthly spend trend and cumulative spend over the year
- Most expensive single journey
- With the Product column: estimate whether a subscription (e.g. weekend-vrij /
  dal-voordeel) would have paid for itself versus what was actually paid

## 3. Commute fingerprint / habits

- Punch-card heatmap: day-of-week × hour-of-check-in
- Most-travelled origin–destination pair
- Top 10 stations by visits
- Longest streak of consecutive travel days
- Earliest/latest check-ins ever

The check-in time merging (`mergeJourneys`) already makes this trivial.

## 4. Network coverage map

A "scratch map" of the Netherlands: which rail segments and stations you've ever
touched, rendered as a highlighted layer over the full lijnnetkaart network.

- "You've used 14% of the Dutch rail network"
- "37 unique stations visited"

The route geometries are already pooled, so it's mostly a union of matched polylines.

## 5. Intercity vs. Sprinter behaviour (NS-specific)

Because `findGtfsMatch` identifies the likely departure including train type:

- Your IC/Sprinter ratio
- Typical dwell time between check-in and actual departure ("you check in on average
  4 minutes before the train leaves" — sprinter-to-the-platform person or early
  arriver?)
- Per-station versions of the above

## 6. Anomaly / outlier gallery

- Slowest journey relative to its distance (delay proxy)
- `rondrit` count (checked in and out at the same stop — forgot to check out, or
  just a wander?)
- Unusually expensive trips for their distance
- Trips at unusual hours compared to your own baseline

## 7. Geographic extremes

- Northernmost / southernmost / easternmost / westernmost points ever reached
- Furthest point from home station
- Centroid of all travel ("your personal centre of gravity is somewhere near
  Utrecht Centraal" — which for most Dutch travellers it will be; funny either way)

## 8. Transfer analysis

The A* rail-path journeys (`findRailPath`) identify multi-leg trips:

- Most common transfer stations
- Fraction of train travel that involves a transfer
