# Dutch Public Transport (OV) Open Data — API & Data Source Inventory

**Compiled:** 2026-06-09  
**Purpose:** Reference for the OVerzicht browser extension visualising OV-chipkaart travel history

---

## 1. Executive Summary

The five most useful sources for the OVerzicht extension's core needs (route geometry, real-time arrivals, stop lookup):

- **gtfs.ovapi.nl** — Single most practical entry point. Daily-updated 206 MB national GTFS static feed (`gtfs-nl.zip`) plus live GTFS-RT Protocol Buffer feeds (trip updates, vehicle positions, alerts) every few minutes. No auth. CC-0. Operated by Stichting OpenGeo/GOVI.
- **NDOV Loket / GOVI (`data.ndovloket.nl`)** — Canonical national open-data hub. Hosts KV1 timetable zips per operator, NeTEx feeds, real-time ZeroMQ streams (KV6, KV78Turbo, NS InfoPlus, SIRI), stop/CHB data, occupancy, fares. CC-0. Free registration required for ZeroMQ real-time tier.
- **OVapi REST API (`v0.ovapi.nl`)** — JSON REST wrapper over GTFS + KV78Turbo data. Endpoints for stops, timing points, lines with real-time departures. No auth. TLS certificate currently expired (2026-06); treat as best-effort.
- **NS API Portal (`apiportal.ns.nl`)** — Official NS (Dutch Railways) REST API. Arrivals, departures, disruptions, journey planning, station data in JSON. Free API-key registration required. Authoritative for train-specific data.
- **openOV.nl / Stichting OpenGeo** — The open-data initiative producing the GTFS/GTFS-RT feeds and OVapi REST layer. Also source of KV78Turbo and NSAPIturbo best-effort data streams.

---

## 2. Per-Source Detailed Entries

---

### 2.1 gtfs.ovapi.nl — GTFS Static + GTFS-RT Feeds

**Operated by:** Stichting OpenGeo (now GOVI)  
**Base URL:** `https://gtfs.ovapi.nl/`  
**Status:** Active

#### Available feeds

| Path | Contents | Size | Updated |
|------|----------|------|---------|
| `/nl/gtfs-nl.zip` | Full Netherlands static GTFS | 206 MB | Daily |
| `/nl/tripUpdates.pb` | GTFS-RT TripUpdates (all operators) | 6.3 MB | Every few minutes |
| `/nl/vehiclePositions.pb` | GTFS-RT VehiclePositions | 532 KB | Every few minutes |
| `/nl/alerts.pb` | GTFS-RT ServiceAlerts | 3.0 MB | Every few minutes |
| `/nl/trainUpdates.pb` | GTFS-RT train-specific updates | 2.6 MB | Every few minutes |
| `/govi/gtfs-kv7-latest.zip` | Daily KV7-format GTFS (bus/tram/metro/ferry) | ~7 MB | Daily ~05:00 UTC |
| `/openov-nl/gtfs-openov-nl.zip` | NL GTFS excluding AVV + Thalys | 205 MB | Daily |
| `/nl/gtfs-realtime-OVapi.proto` | OVapi GTFS-RT extension schema | 2.5 KB | — |
| `/nl/gtfs-realtime.proto` | Standard GTFS-RT proto | 26 KB | — |

#### OVapi GTFS-RT Extensions (field number 1003)

Extended fields added on top of standard GTFS-RT:

- `OVapiTripDescriptor`: `realtime_trip_id`, `trip_short_name`, `commercial_mode_id`
- `OVapiVehiclePosition`: `delay` (signed seconds)
- `OVapiTripUpdate`: `trip_headsign`
- `OVapiStopTimeUpdate`: `stop_headsign`, `scheduled_track`, `actual_track`, `station_id`
- `OVapiVehicleDescriptor`: `wheelchair_accessible`, `vehicle_type`, `vehicle_headsign`

#### Auth / Caching
None. Include an identifying `User-Agent`. Respect `If-Modified-Since` / `If-None-Match`. Do not poll more than once per minute.

**Coverage:** National (NS, Arriva, Connexxion, EBS, GVB, HTM, Keolis, Q-Buzz, RET, and others)  
**License:** CC-0

---

### 2.2 NDOV Loket / GOVI (`data.ndovloket.nl`)

**Operated by:** Stichting OpenGeo as GOVI (formerly NDOV Loket; ndovloket.nl redirects to govi.nu)  
**Base URL:** `https://data.ndovloket.nl/`  
**Registration:** `https://govi.nu/aanmelden`

#### Static file datasets

| Path | Contents | Format |
|------|----------|--------|
| `/ns/ns-latest.zip` | NS timetable (latest) | KV1/HAFAS |
| `/avv/KV1_AVV_YYYYMMDD.zip` | Arriva timetables | KV1 |
| `/netex/{operator}/` | Per-operator NeTEx feeds | NeTEx XML |
| `/haltes/ExportCHB_YYYY-MM-DD.xml.gz` | Stop infrastructure (CHB) | XML/NeTEx |
| `/bezetting/{operator}/OC_*.csv.gz` | Occupancy by operator | CSV gzip |
| `/prorail/LIFTEN*.csv` | Lift/elevator data | CSV |
| `/prorail/PERRON*.csv` | Platform data | CSV |

**NeTEx operators:** arr, avv, cxx, ebs, gvb, keolis, qbuzz, ret, htm, doeksen, flixbus, and more.

#### Real-time ZeroMQ streams (BISON protocol)

Best-effort tier (no agreement, CC-0, max 1 connection/stream):

| Data Type | ZeroMQ URI | Protocol |
|-----------|-----------|---------|
| BISON (KV6, KV15, KV17) | `tcp://pubsub.besteffort.ndovloket.nl:7658` | ZeroMQ PubSub |
| KV78Turbo | `tcp://pubsub.besteffort.ndovloket.nl:7817` | ZeroMQ PubSub |
| NS InfoPlus | `tcp://pubsub.besteffort.ndovloket.nl:7664` | ZeroMQ PubSub |
| SIRI | `tcp://pubsub.besteffort.ndovloket.nl:7666` | ZeroMQ PubSub |

Subscription envelope prefixes e.g. `/ARR/KV6posinfo`, `/CXX/KV15messages`, `/RIG/InfoPlusDVSInterface4`.

**License:** CC-0

---

### 2.3 OVapi REST API (`v0.ovapi.nl`)

**Base URL:** `http://v0.ovapi.nl/` (HTTPS TLS certificate expired 2026-06)  
**Status:** Degraded

#### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /stopareacode/{code}` | Stop info by stop area code |
| `GET /tpc/{timing_point_code}` | Departures by timing point code |
| `GET /line/{line_code}` | Line information |
| `GET /line/{line_code}_1` | Line direction 1 |
| `GET /line/{line_code}_2` | Line direction 2 |

**Format:** JSON | **Auth:** None  
**Notable:** Known coverage gaps. Alternative: `https://drgl.nl/stop/{NL:S:stop_code}`

---

### 2.4 NS API Portal (`apiportal.ns.nl`)

**Base URL:** `https://apiportal.ns.nl/`  
**Status:** Active, requires free API key registration

#### Key endpoints

- `GET /reisinformatie-api/api/v2/departures` — departures from station
- `GET /reisinformatie-api/api/v2/arrivals` — arrivals at station
- Disruptions, journey planning, station info

**Format:** JSON | **Auth:** API key (free registration)  
**Coverage:** NS rail network only; does not cover bus/tram/metro

---

### 2.5 openOV.nl / Stichting OpenGeo

**URL:** `https://openov.nl/`  
**Contact:** secretariaat@openov.nl

Parent organisation of GOVI, gtfs.ovapi.nl, and OVapi. Key datasets:

| Dataset | Source | Format | License |
|---------|--------|--------|---------|
| KV78turbo live | DOVA | KV78Turbo (ZeroMQ) | CC-0 |
| NSAPIturbo live | NS | NSAPIturbo (ZeroMQ) | CC-0 |
| GTFS-RT | OVapi | GTFS-RT (protobuf) | CC-0 |
| KV1 timetables | NDOVloket | KV1 ZIP | CC-0 |
| GTFS static | OVapi | GTFS ZIP | CC-0 |
| Stop names/positions | OVapi | JSON/GTFS | CC-0 |
| Platform geodata | ProRail | CSV | CC-0 |
| Rail tariffs | Rijden de Treinen | CSV | CC-0 + attribution |

Direct data access: `http://data.openov.nl/` (certificate expired; use `data.ndovloket.nl` instead)

---

### 2.6 BISON / DOVA

**URL:** `https://bison.dova.nu/` / `https://dova.nu/`  
**Role:** Standards body for Dutch OV data exchange

BISON is the Dutch platform maintaining OV data exchange standards. DOVA is the collaboration of 12+ regional transit authorities.

#### Active BISON Standards

| Standard | Description |
|----------|-------------|
| NL NeTEx | Dutch profile of NeTEx (network, timetables, stops, fares) — primary static format |
| NL SIRI | Dutch profile of SIRI (real-time service information) |
| CHB | Physical stop structure and accessibility |
| KV6 | Vehicle punctuality and position |
| KV7/8 | Planned/actual travel information at stop level |
| KV7/8 Turbo | Efficient KV7/8 over ZeroMQ using CTX wire format |
| KV15 | Stop announcements / free text |
| KV17 | Operational timetable mutations |

**Deprecated (Dec 2024):** KV1, KV4, older SIRI profile.  
NeTEx 9.4.0 (March 2026) switched coordinates from RijksDriehoekstelsel to WGS-84.

---

### 2.7 api.ov.duinn.nl — OV Emissions API

**Base URL:** `https://api.ov.duinn.nl`  
**Status:** Active (version 0 — unstable)

`GET /api/v0/emissions` — Raw emission data per transport mode/concession

**Parameters:** `format` (json/csv/geojson), `grouping`, `years`, `months`, `transport_type` (bus/tram/metro/train/all)

**Auth:** None | **License:** CC BY-NC 4.0 (non-commercial only)

---

### 2.8 Rijden de Treinen / GoTrain

**Open data:** `https://rijdendetreinen.nl/open-data`  
**GoTrain source:** `https://github.com/rijdendetreinen/gotrain` (Go, GPL v3)

#### Open datasets

| Dataset | License | Coverage |
|---------|---------|---------|
| Treinstoringen (disruptions) | CC0/CC-BY | Historical since 2011 |
| Treinstations (stations) | CC0/CC-BY | All Dutch stations |
| Treinarchief (trip archive) | CC0/CC-BY | Since 2019 |
| Tariefafstanden (fare distances) | CC0/CC-BY | All station pairs |

#### GoTrain REST API

Consumes NDOV ZeroMQ NS InfoPlus streams, exposes JSON REST API.

| Endpoint | Description |
|----------|-------------|
| `GET /v2/departures/station/{station}` | Departing trains |
| `GET /v2/arrivals/station/{station}` | Arriving trains |
| `GET /v2/services/service/{service_number}/{date}` | Full journey details |

---

### 2.9 KV78Turbo-OVAPI (Reference Implementation)

**Repository:** `https://github.com/skywave/KV78Turbo-OVAPI`  
**Language:** Python | Stars: 100

Reference implementation of the REST API wrapping KV78Turbo ZeroMQ data. Key modules: `kv78turbo-api.py`, `halte-db.py`, `ctx.py` (CTX wire format handler). Original test endpoint (`http://kv78turbo.ovapi.nl`) is offline; use `v0.ovapi.nl` or direct GTFS-RT instead.

---

### 2.10 Bliksem Integration

**Repository:** `https://github.com/bliksemlabs/bliksemintegration`  
**Language:** Python | License: BSD-2-Clause

Data normalisation pipeline ingesting NS, Q-Buzz, RET, AVV, CXX and exporting to GTFS/GTFS-RT. Reference for understanding how KV1/operator formats map to GTFS.

---

### 2.11 ProRail Data (via NDOV Loket)

**Path:** `https://data.ndovloket.nl/prorail/`

| Dataset | Contents |
|---------|----------|
| `LIFTEN DEC 2025.csv` | Elevator/lift locations at train stations |
| `PERRON DEC 2025.csv` | Platform data |
| `HELLINGBAAN DEC 2025.csv` | Ramp/slope accessibility data |

**License:** CC-0 | **Update frequency:** Quarterly

---

### 2.12 9292 Journey Planner

**URL:** `https://developer.9292.nl/` — connection refused  
**Status:** No confirmed public API as of 2026-06-09. Internal/commercial use only.

---

### 2.13 DRGL.nl

**Base URL:** `https://drgl.nl/`  
**Pattern:** `GET https://drgl.nl/stop/{NL:S:stop_code}`

Consumer-facing departure board with better stop coverage than OVapi for some stops. No documented public API.

---

### 2.14 OV-chipkaart (Translink) — No Public API

No official public API for OV-chipkaart travel history or transactions. The OVerzicht extension accesses the authenticated web portal via the mobile gateway API (`api2.ov-chipkaart.nl/femobilegateway/v1`) documented in `research/api_notes.md`.

---

## 3. Data Format Glossary

| Format | Description |
|--------|-------------|
| **KV1** | Static timetable data: planned routes, stops, trips. XML/CSV in ZIP. Deprecated in favour of NeTEx. |
| **KV6** | Real-time vehicle position reports with schedule deviation. ZeroMQ/XML. |
| **KV7** | Planned scheduled departures per stop for coming days. Basis for departure boards. |
| **KV8** | Actual/predicted departure times per stop, derived from KV6. The "current departures" feed. |
| **KV78Turbo** | Efficient combined KV7+KV8 over ZeroMQ using CTX wire format. Underlies OVapi REST and GTFS-RT. |
| **KV15** | Stop announcements / free-text messages. ZeroMQ/XML. |
| **KV17** | Operational timetable mutations (cancellations, additions). |
| **CTX** | Compressed Text Format — compact CSV-like wire serialisation used in KV78Turbo. |
| **BISON** | Umbrella term for Dutch OV data exchange standards; also the ZeroMQ endpoint port 7658. |
| **GTFS** | Static transit standard (stops.txt, routes.txt, trips.txt, stop_times.txt, shapes.txt) in a ZIP. `gtfs-nl.zip` covers all Dutch operators. |
| **GTFS-RT** | Protocol Buffer extension to GTFS for real-time TripUpdates, VehiclePositions, ServiceAlerts. |
| **NeTEx** | CEN European XML standard replacing KV1. Primary Dutch static format. WGS-84 coords since v9.4.0 (March 2026). |
| **SIRI** | European XML standard for real-time OV (SIRI-SM stop monitoring, SIRI-ET estimated timetables). Dutch profile on GOVI ZeroMQ port 7666. |
| **CHB** | Centrale Halte Basisregistratie — national stop registry with precise stop positions, names, accessibility. |
| **IFF** | International Fare Format — used for NS timetable exchange. |

---

## 4. Recommendations for OVerzicht

### Route Geometry

**Primary:** `gtfs.ovapi.nl/nl/gtfs-nl.zip` → `shapes.txt`

Match operator + line from OV-chipkaart data against GTFS `routes.txt`/`trips.txt` → `shape_id` → `shapes.txt` polyline. Preprocess into compact local JSON (see `scripts/build_route_geometries.py`). No auth, CC-0, updated daily.

**Local fallback:** `20260511.zip` lijnnetkaart shapefile (TRAIN/TRAM/METRO, 755 routes) already in repo.

### Stop Lookup

**Use:** `gtfs.ovapi.nl/nl/gtfs-nl.zip` → `stops.txt`, or existing `web_extension/data/stops.json`.  
**Enriched accessibility:** `data.ndovloket.nl/haltes/ExportCHB_*.xml.gz`.

### Real-Time Vehicle Positions

**Use:** `gtfs.ovapi.nl/nl/vehiclePositions.pb` (GTFS-RT, updated every few minutes, no auth, CC-0).  
Parse with standard GTFS-RT protobuf library + OVapi extension schema. `OVapiVehiclePosition.delay` field gives signed-seconds delay.

**Trains specifically:** NS API (`apiportal.ns.nl`, free key) for richer journey context.

### API Access Summary

| Need | Source | Auth | License |
|------|--------|------|---------|
| Route geometry | `gtfs.ovapi.nl/nl/gtfs-nl.zip` (shapes.txt) | None | CC-0 |
| Stop coordinates | `gtfs.ovapi.nl/nl/gtfs-nl.zip` (stops.txt) | None | CC-0 |
| Stop accessibility | `data.ndovloket.nl/haltes/` (CHB XML) | None | CC-0 |
| Real-time vehicle positions | `gtfs.ovapi.nl/nl/vehiclePositions.pb` | None | CC-0 |
| Real-time trip updates | `gtfs.ovapi.nl/nl/tripUpdates.pb` | None | CC-0 |
| Train departures/arrivals | `apiportal.ns.nl` | API key (free) | Proprietary |
| Historical trip archive | `rijdendetreinen.nl/open-data` | None | CC-0/CC-BY |
| Emissions per mode | `api.ov.duinn.nl/api/v0/emissions` | None | CC BY-NC 4.0 |
| KV78Turbo real-time ZMQ | `pubsub.besteffort.ndovloket.nl:7817` | None (fair-use) | CC-0 |
| OV-chipkaart history | ov-chipkaart.nl (mobile gateway) | Session auth | N/A |
