#!/usr/bin/env node
/**
 * Replays cached trips through the dashboard matching pipeline (matching.js)
 * and reports per-trip results.
 *
 * Usage:
 *   node scripts/test_route_matching.js [trips.json] [--verbose]
 *
 * trips.json: either an array of trip objects or an object with a `trips` key
 * (e.g. a decoded chrome.storage.local dump). Defaults to
 * /tmp/overzicht_storage.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'web_extension/dashboard/matching.js'));

const args = process.argv.slice(2).filter(a => a !== '--verbose');
const verbose = process.argv.includes('--verbose');
const tripsPath = args[0] || '/tmp/overzicht_storage.json';

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const stations  = loadJson(path.join(ROOT, 'web_extension/data/stops.json'));
const routes    = loadJson(path.join(ROOT, 'web_extension/data/routes.json'));
const schedules = loadJson(path.join(ROOT, 'web_extension/data/schedules.json'));
M.setMatchData({ stations, routes, schedules });

let raw = loadJson(tripsPath);
if (!Array.isArray(raw)) raw = raw.trips;
if (!Array.isArray(raw)) throw new Error('no trips array found in ' + tripsPath);

console.log(`Loaded ${raw.length} rows from ${tripsPath}`);

const journeys = M.mergeJourneys ? M.mergeJourneys(raw) : raw;
if (M.mergeJourneys) {
  console.log(`Merged into ${journeys.length} rows (${journeys.filter(j => j.from && j.to).length} complete journeys)`);
}

// ── Replay renderTrips() decision flow ───────────────────────────────────────

const results = [];
for (const trip of journeys) {
  if (!trip.from || !trip.to) continue;

  if (M.refreshTripInference) M.refreshTripInference(trip);

  const resolved  = M.resolveJourneyStops(trip);
  const fromCoord = resolved.from;
  const toCoord   = resolved.to;
  const dbg = { poolSize: 0, publicCode: null, narrowedSize: 0 };

  let result, dep = null, coords = null;
  if (!fromCoord || !toCoord) {
    result = 'stop ontbreekt';
  } else if (trip.from === trip.to) {
    result = 'rondrit';
  } else {
    const gtfs = M.findGtfsMatch(trip, fromCoord, toCoord);
    dep = gtfs?.dep ?? null;
    coords = gtfs?.coords ?? M.findRouteGeometry(trip, fromCoord, toCoord, dbg);
    result = coords ? (gtfs?.coords ? 'gtfs route' : 'echte route') : 'rechte lijn';
  }

  results.push({ trip, dbg, dep, result, fromCoord, toCoord, coords });
}

// ── Report ───────────────────────────────────────────────────────────────────

const byResult = {};
for (const r of results) (byResult[r.result] ??= []).push(r);

console.log('\n=== Summary ===');
for (const [k, v] of Object.entries(byResult).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(v.length).padStart(4)}  ${k}`);
}
console.log(`${String(results.length).padStart(4)}  total drawable rows`);

const bad = results.filter(r => r.result !== 'gtfs route' && r.result !== 'echte route' && r.result !== 'rondrit');
if (bad.length) {
  console.log('\n=== Failures ===');
  const seen = new Map();
  for (const r of bad) {
    const key = `${r.result} | ${r.trip.from} -> ${r.trip.to} | op=${r.trip.operator} | prod=${r.trip.product}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}× ${k}`);
  }
}

// ── Geometry sanity: matched line length vs straight-line distance ──────────

function kmDist(a, b) {
  const dlat = (a[0] - b[0]) * 111.2;
  const dlon = (a[1] - b[1]) * 111.2 * 0.629;
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

function lineKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += kmDist(coords[i - 1], coords[i]);
  return s;
}

const suspicious = [];
for (const r of results) {
  if (!r.coords || !r.fromCoord || !r.toCoord) continue;
  const straight = kmDist([r.fromCoord.lat, r.fromCoord.lon], [r.toCoord.lat, r.toCoord.lon]);
  const along = lineKm(r.coords);
  r.straightKm = straight;
  r.alongKm = along;
  // Route should not be shorter than the crow-flies distance, nor absurdly longer.
  const endGapFrom = kmDist(r.coords[0], [r.fromCoord.lat, r.fromCoord.lon]);
  const endGapTo   = kmDist(r.coords[r.coords.length - 1], [r.toCoord.lat, r.toCoord.lon]);
  if (along < straight * 0.85 || (along > straight * 3 + 2) || endGapFrom > 5 || endGapTo > 5) {
    suspicious.push({ r, straight, along, endGapFrom, endGapTo });
  }
}

if (suspicious.length) {
  console.log(`\n=== Suspicious geometry (${suspicious.length}) ===`);
  for (const { r, straight, along, endGapFrom, endGapTo } of suspicious) {
    console.log(`${r.trip.from} -> ${r.trip.to}: straight=${straight.toFixed(1)}km along=${along.toFixed(1)}km gaps=${endGapFrom.toFixed(2)}/${endGapTo.toFixed(2)}km [${r.result}] ${r.dbg.matchedRoute ?? ''}`);
  }
} else {
  console.log('\nGeometry sanity: all matched lines have plausible length and endpoints.');
}

if (verbose) {
  console.log('\n=== All rows ===');
  for (const r of results) {
    const d = r.dep ? ` dep=${r.dep.dep} ${r.dep.type}→${r.dep.headsign}` : '';
    const len = r.alongKm !== undefined ? ` ${r.straightKm.toFixed(1)}→${r.alongKm.toFixed(1)}km` : '';
    const via = r.dbg.matchedRoute ? ` via ${r.dbg.matchedRoute} (${r.dbg.matchedOperator ?? '?'})` : '';
    console.log(`${r.result.padEnd(13)} ${r.trip.date} ${(r.trip.checkIn || '--:--').padEnd(5)} ${r.trip.from} -> ${r.trip.to} [${r.trip.operator}]${len}${via}${d}`);
  }
}
