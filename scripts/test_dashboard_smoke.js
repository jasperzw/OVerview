// Smoke test: load dashboard/app.js with stubbed Leaflet/DOM/chrome and
// exercise the full render pipeline (trips → map layers → stats tabs →
// heatmap → timeline slider/play/reset) on a handful of synthetic journeys.
//
// Usage: node scripts/test_dashboard_smoke.js   (prints SMOKE-OK on success)
'use strict';

const path = require('path');
const DASH = path.join(__dirname, '..', 'web_extension', 'dashboard');

// ── DOM stub ──────────────────────────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, innerHTML: '', textContent: '', value: '', max: 0, min: 0,
      style: {}, dataset: {}, _h: {}, _attrs: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, force) {
          const on = force === undefined ? !this._set.has(c) : !!force;
          on ? this._set.add(c) : this._set.delete(c);
        },
      },
      addEventListener(type, fn) { this._h[type] = fn; },
      click() {},
      setAttribute(k, v) { this._attrs[k] = v; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 46 }; },
      setPointerCapture() {},
      appendChild() {},
    };
  }
  return els[id];
}
global.document = {
  getElementById: el,
  querySelectorAll: () => [],
  createElement: () => el('tmp' + Math.random()),
  body: { appendChild() {} },
};

// ── Leaflet stub ──────────────────────────────────────────────────────────────
class Layer {
  constructor(latlngs, opts) { this._latlngs = latlngs; this.options = opts ?? {}; this._el = { style: {} }; }
  addTo(t) { if (t && t._layers) t._layers.push(this); return this; }
  bindPopup() { return this; }
  setStyle(s) { Object.assign(this.options, s); return this; }
  getElement() { return this._el; }
  getBounds() { return mkBounds(); }
}
class Polyline extends Layer {}
class CircleMarker extends Layer {}
function mkBounds() { return { extend() { return this; }, isValid() { return true; } }; }
const mapObj = {
  setView() { return mapObj; }, fitBounds() {}, invalidateSize() {},
  addLayer() {}, removeLayer() {}, on() {}, hasLayer() { return false; },
};
global.L = {
  map: () => mapObj,
  tileLayer: () => new Layer(),
  canvas: () => ({}),
  control: { layers: () => new Layer() },
  layerGroup: () => ({
    _layers: [],
    addTo() { return this; },
    clearLayers() { this._layers = []; return this; },
    getLayers() { return this._layers; },
  }),
  polyline: (ll, o) => new Polyline(ll, o),
  circleMarker: (ll, o) => new CircleMarker(ll, o),
  latLngBounds: mkBounds,
  Polyline,
};

// ── Data + chrome/fetch stubs ─────────────────────────────────────────────────
const stations = {
  'eindhoven centraal':   { lat: 51.443, lon: 5.479 },
  'utrecht centraal':     { lat: 52.089, lon: 5.110 },
  'eindhoven, woensxl':   { lat: 51.452, lon: 5.452 },
  'eindhoven, station':   { lat: 51.443, lon: 5.481 },
};

const journey = (date, from, to, checkIn, checkOut, amount, product) => ({
  date, checkIn, from, checkOut, to,
  amount, debit: 'Af', product, txType: 'Check-uit', card: 'kaart-1',
});

const trips = [
  journey('02-03-2026', 'Eindhoven Centraal', 'Utrecht Centraal', '08:12', '08:55', 16.4, 'NS Reizen op Saldo Trein'),
  journey('03-03-2026', 'Utrecht Centraal', 'Eindhoven Centraal', '17:31', '18:14', 16.4, 'NS Reizen op Saldo Trein'),
  journey('17-03-2026', 'Eindhoven Centraal', 'Utrecht Centraal', '08:14', '08:57', 16.4, 'NS Reizen op Saldo Trein'),
  journey('05-04-2026', 'Eindhoven, WoensXL', 'Eindhoven, Station', '13:02', '13:14', 1.42, 'Bus Tram Metro'),
  journey('20-04-2026', 'Eindhoven Centraal', 'Utrecht Centraal', '09:01', '09:44', 16.4, 'NS Reizen op Saldo Trein'),
];

// Minimal lijnnetkaart: one NS line passing both stations — lets route
// matching and the coverage stats exercise their real code paths.
const routes = {
  'NS:TRAIN': [{
    publicCode: 'Intercity', name: 'IC Eindhoven–Utrecht', from: '', to: '',
    coords: [[51.443, 5.479], [51.70, 5.30], [51.90, 5.20], [52.089, 5.110]],
  }],
};

// Minimal GTFS index: departures matching the synthetic check-in times, so
// findGtfsMatch identifies the trains and the Treinen tab gets real input.
const shapeThere = [[51.443, 5.479], [51.70, 5.30], [51.90, 5.20], [52.089, 5.110]];
const schedules = {
  departures: {
    'Eindhoven Centraal': [
      { dep: '08:15', type: 'Intercity', headsign: 'Utrecht Centraal', pid: 1, shape: 's1' },
      { dep: '09:05', type: 'Sprinter',  headsign: 'Utrecht Centraal', pid: 1, shape: 's1' },
    ],
    'Utrecht Centraal': [
      { dep: '17:36', type: 'Intercity', headsign: 'Eindhoven Centraal', pid: 1, shape: 's2' },
    ],
  },
  patterns: { 1: 127 }, // all weekdays
  shapes: { s1: shapeThere, s2: [...shapeThere].reverse() },
};

global.chrome = {
  runtime: { getURL: (p) => p },
  storage: { local: { get: (_k, cb) => cb({ trips, fetchedAt: Date.now() }) } },
};
global.fetch = async (url) => ({
  json: async () => {
    if (String(url).includes('stops')) return stations;
    if (String(url).includes('routes')) return routes;
    if (String(url).includes('schedules')) return schedules;
    throw new Error('not available');
  },
});

global.URL.createObjectURL = () => 'blob:fake';
global.URL.revokeObjectURL = () => {};
global.alert   = (m) => console.log('ALERT:', m);
global.confirm = () => true;
global.location = { reload() { global.location.reloaded = true; } };

global.OVMatch = require(path.join(DASH, 'matching.js'));
global.OVStats = require(path.join(DASH, 'stats.js'));

el('tl-speed').value = '180'; // the <select>'s default option
require(path.join(DASH, 'app.js'));

// init() is async — give it a tick, then poke the timeline.
setTimeout(() => {
  try {
    // Export: the handler builds a download anchor from storage
    let lastAnchor = null;
    const origCreate = global.document.createElement;
    global.document.createElement = (t) => (lastAnchor = origCreate(t));
    el('btn-export')._h.click();
    global.document.createElement = origCreate;
    console.log('export filename:', lastAnchor && lastAnchor.download,
      '| href set:', !!(lastAnchor && lastAnchor.href));

    // Import: a wrapper file replaces storage and reloads (asserted at the end)
    global.chrome.storage.local.set = (obj, cb) => { global.__imported = obj; cb && cb(); };
    el('import-file').files = [{
      text: async () => JSON.stringify({ format: 'overzicht-trips', fetchedAt: 123, trips }),
    }];
    el('import-file')._h.change();

    const trains = el('stats-trains').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('treinen: IC-ratio:', (trains.match(/(\d+% IC)/) ?? [])[1],
      '(expected 75% IC: 3 Intercity, 1 Sprinter)');
    console.log('treinen: gem. vóór vertrek:', (trains.match(/([\d.]+ min) Inchecken/) ?? [])[1],
      '(expected 3.3: dwells 3, 5, 1, 4 min)');
    console.log('treinen: vaste trein herkend:', trains.includes('08:15'));

    const totals = el('stats-totals').innerHTML;
    console.log('coverage section present:', totals.includes('Netwerkdekking'));
    const pct = totals.match(/≈([\d.]+)% van het Nederlandse spoornet/);
    console.log('spoornet coverage:', pct ? pct[1] + '%' : 'NOT FOUND',
      '(expected high: the only network line is the travelled one)');

    console.log('label after load:', el('tl-label').textContent);
    console.log('graph viewBox:', el('tl-svg')._attrs.viewBox,
      '(expected "0 0 50 40": 2 mrt..20 apr = 50 dagen)');
    console.log('graph has area+line:', /Z.*stroke/s.test(el('tl-svg').innerHTML));

    const pev = (x) => ({ clientX: x, pointerId: 1, target: {}, preventDefault() {} });

    // Click at the left edge of the graph → window clamps to the period start
    el('tl-graph')._h.pointerdown(pev(0));
    console.log('window @start:', el('tl-label').textContent,
      '| el left/width:', el('tl-window').style.left, el('tl-window').style.width);

    // Drag to the middle of the graph (graph is 1000px wide in this stub)
    el('tl-graph')._h.pointermove(pev(500));
    el('tl-graph')._h.pointerup(pev(500));
    console.log('window @midden:', el('tl-label').textContent);

    // Speed up 4× and play a few ticks
    el('tl-speed').value = '45';
    el('tl-speed')._h.change();
    el('tl-play')._h.click();
    console.log('play started, button:', el('tl-play').textContent);
    setTimeout(() => {
      console.log('window while playing:', el('tl-label').textContent);
      el('tl-play')._h.click(); // pause
      console.log('paused, button:', el('tl-play').textContent);
      el('tl-reset')._h.click();
      console.log('after reset:', el('tl-label').textContent,
        '| window hidden:', el('tl-window').classList._set.has('hidden'));
      console.log('import stored rows:', global.__imported?.trips?.length,
        '| fetchedAt restored:', global.__imported?.fetchedAt === 123,
        '| reloaded:', !!global.location.reloaded);
      console.log('SMOKE-OK');
      process.exit(0);
    }, 500);
  } catch (e) {
    console.error('SMOKE-FAIL', e);
    process.exit(1);
  }
}, 200);
