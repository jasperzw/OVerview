# OVerzicht

A browser extension that visualises your Dutch public-transport (OV-chipkaart)
travel history on an interactive map.

> ⚠️ **Personal/experimental project.** It talks to ov-chipkaart.nl using *your own*
> logged-in session and only ever stores data locally in the browser. No data leaves
> your machine.

## What it does

1. Adds a **🗺 OVerzicht** button next to each card on
   [ov-chipkaart.nl](https://www.ov-chipkaart.nl/nl/mijn-ov-chip/mijn-ov-reishistorie).
2. On click it fetches up to a year of travel history through the site's own backend API
   (reusing the session token from the page you're already logged in to).
3. It parses the history and stores it in `chrome.storage.local`.
4. It opens a dashboard tab with a Leaflet map that draws every journey as a real
   geometric route, plus a sortable trips table.

Routes are reconstructed from open data (OpenOV *lijnnetkaart* geometries and the
GTFS-NL feed), so each trip is drawn along the actual track/line rather than as a
straight line.

## Install (developer / temporary load)

The extension is not published to any store — load it unpacked:

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`
2. *Load Temporary Add-on…* → pick `web_extension/manifest.json`

**Chrome / Edge**
1. Go to `chrome://extensions`, enable *Developer mode*
2. *Load unpacked* → select the `web_extension/` folder

Then open ov-chipkaart.nl, log in, and click the **🗺 OVerzicht** button on a card.

## Project layout

```
web_extension/      The extension itself (Manifest V3, Firefox + Chrome)
  manifest.json
  scripts/          Content script, auth-token capture, API bridge, background
  dashboard/        Leaflet map, trips table, and all route-matching logic
  popup/            Toolbar popup
  data/             Generated reference data (stops, route geometries, schedules)
  lib/              Bundled Leaflet (MV3 blocks CDN scripts)
scripts/            Python/Node tooling that builds the data/ files
research/           Reverse-engineering and design notes
docs/               Planning notes and a detailed handover document
```

## Rebuilding the reference data

The `web_extension/data/*.json` files are generated from public open-data sources:

```bash
# Route geometries from the OpenOV lijnnetkaart shapefile
python3 scripts/build_route_geometries.py /path/to/lijnnetkaart

# NS departure index from the GTFS-NL feed (https://gtfs.ovapi.nl/nl/gtfs-nl.zip)
python3 scripts/build_trip_schedules.py /path/to/gtfs-nl.zip

# Replay a cached trips dump through the matching code (Node)
node scripts/test_route_matching.js path/to/trips.json
```

See [`docs/HANDOVER.md`](docs/HANDOVER.md) for the full architecture, the auth
mechanism, and the route-matching pipeline.

## License

[Boost Software License 1.0](LICENSE).
