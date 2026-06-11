// ─── Map init ─────────────────────────────────────────────────────────────────

const map = L.map('map').setView([52.2, 5.3], 7);

// OSM's own servers block tile requests from extension origins (no Referer).
// CARTO uses the same OSM data and has no referrer requirement.
const osmLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
               ' © <a href="https://carto.com/attributions">CARTO</a>' +
               ' | © <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
  maxZoom: 19,
}).addTo(map);

const ormLayer = L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
  maxZoom: 19,
  opacity: 0.6,
  // ORM tiles are 512 px retina renders displayed at 256 px
  tileSize: 512,
  zoomOffset: -1,
});

// Vector layers: per-trip polylines (default), a frequency heatmap where
// often-travelled paths and often-visited stops glow hotter, and a coverage
// scratch map showing the full rail network with the travelled part lit up
// (both off by default).
let routeLayer    = L.layerGroup().addTo(map);
let heatLayer     = L.layerGroup();
let coverageLayer = L.layerGroup();

L.control.layers(
  null,
  {
    'Ritten': routeLayer,
    'Heatmap (frequentie)': heatLayer,
    'Dekking (scratch map)': coverageLayer,
    'Spoorwegen (OpenRailwayMap)': ormLayer,
  },
  { position: 'topright', collapsed: false }
).addTo(map);

// ─── Operator colours ─────────────────────────────────────────────────────────

const OPERATOR_COLOUR = {
  NS:         '#003082',
  GVB:        '#e2001a',
  RET:        '#e87722',
  HTM:        '#6db33f',
  Connexxion: '#9b59b6',
  Arriva:     '#f39c12',
  Qbuzz:      '#1abc9c',
  Bus:        '#7f8c8d',
  Tram:       '#c0392b',
  Metro:      '#2980b9',
  OV:         '#95a5a6',
};

function colourForOperator(op) {
  return OPERATOR_COLOUR[op] ?? OPERATOR_COLOUR.OV;
}

// ─── Data loading ─────────────────────────────────────────────────────────────
// All matching logic lives in matching.js (window.OVMatch); this file only
// loads the data files and hands them over.

async function loadStations() {
  const url = chrome.runtime.getURL('data/stops.json');
  const stations = await fetch(url).then(r => r.json());
  OVMatch.setMatchData({ stations });
}

async function loadRoutes() {
  try {
    const url = chrome.runtime.getURL('data/routes.json');
    const routes = await fetch(url).then(r => r.json());
    OVMatch.setMatchData({ routes });
    console.info('[OVerzicht] routes.json geladen:', Object.keys(routes).length, 'groepen');
  } catch (e) {
    console.warn('[OVerzicht] routes.json niet beschikbaar — rechte lijnen worden gebruikt');
  }
}

async function loadSchedules() {
  try {
    const url = chrome.runtime.getURL('data/schedules.json');
    const schedules = await fetch(url).then(r => r.json());
    OVMatch.setMatchData({ schedules });
    console.info('[OVerzicht] schedules.json geladen:',
      Object.keys(schedules.departures || {}).length, 'stops');
  } catch (e) {
    console.info('[OVerzicht] schedules.json niet beschikbaar — vertrekinfo wordt weggelaten');
  }
}

// ─── Route rendering ──────────────────────────────────────────────────────────

let allTrips = [];
let routeDebugLog = [];
let tripLayerIndex = []; // {dayNum, layers:[line, hit, dot], visible} per drawn trip, for the timeline

function renderTrips(trips) {
  routeLayer.clearLayers();
  routeDebugLog = [];
  tripLayerIndex = [];

  let shown = 0;
  let missing = 0;
  let straightLine = 0;

  // Per-trip records for the statistics tabs (stats.js): the trip plus the
  // geometry that was actually drawn, so distances follow the real route.
  const statsRecords = [];

  // Frequency data for the heatmap overlay: identical paths and stops are
  // pooled, the count drives colour/weight.
  const heatPaths = new Map();
  const heatStops = new Map();

  // Real (matched) geometries for the coverage scratch map.
  const coveragePaths = [];

  trips.forEach((trip) => {
    if (!trip.from || !trip.to) {
      statsRecords.push({ trip, latlngs: null, geometric: false, isRoundTrip: false, mode: null });
      return;
    }

    const resolved  = OVMatch.resolveJourneyStops(trip);
    const fromCoord = resolved.from;
    const toCoord   = resolved.to;

    const dbg = {
      date: trip.date, checkIn: trip.checkIn ?? '', checkOut: trip.checkOut ?? '',
      from: trip.from, to: trip.to,
      operator: trip.operator, product: trip.product ?? '',
      fromFound: !!fromCoord, toFound: !!toCoord,
      poolSize: 0, publicCode: null, narrowedSize: 0,
      matchedRoute: null, matchedOperator: null, matchedMode: null,
      score: null, fromIdx: null, toIdx: null, routePts: null,
      gtfsMatch: null, result: null,
    };

    if (!fromCoord || !toCoord) {
      dbg.result = 'stop ontbreekt';
      routeDebugLog.push(dbg);
      statsRecords.push({ trip, latlngs: null, geometric: false, isRoundTrip: false, mode: null });
      missing++;
      return;
    }

    shown++;

    // Check-in and check-out at the same stop: nothing to draw but a dot.
    const isRoundTrip = trip.from === trip.to;

    // 1. GTFS schedule match — exact shape + departure identification
    const gtfs = isRoundTrip ? null : OVMatch.findGtfsMatch(trip, fromCoord, toCoord);
    const dep  = gtfs?.dep ?? null;

    // 2. Lijnnetkaart proximity matching / rail-network path as fallback
    const routeCoords = isRoundTrip ? null
      : gtfs?.coords ?? OVMatch.findRouteGeometry(trip, fromCoord, toCoord, dbg);
    const latlngs = routeCoords
      ?? [[fromCoord.lat, fromCoord.lon], [toCoord.lat, toCoord.lon]];

    dbg.result    = isRoundTrip ? 'rondrit'
      : routeCoords ? (gtfs?.coords ? 'gtfs route' : 'echte route') : 'rechte lijn';
    dbg.gtfsMatch = dep ? `${dep.dep} ${dep.type}` : null;
    routeDebugLog.push(dbg);

    if (!routeCoords && !isRoundTrip) straightLine++;

    // Mode for the statistics tabs: a GTFS hit is per definition a train, a
    // line match knows its own mode, otherwise fall back to the CSV heuristic
    // ('BTM' when the stop-name shape only narrows it to bus/tram/metro).
    const candidateModes = OVMatch.detectModes(trip);
    const statsMode = gtfs ? 'TRAIN'
      : dbg.matchedMode ?? (candidateModes.length === 1 ? candidateModes[0] : 'BTM');
    statsRecords.push({
      trip,
      latlngs: isRoundTrip ? null : latlngs,
      geometric: !!routeCoords,
      isRoundTrip,
      mode: statsMode,
      gtfsDep: dep, // matched departure {dep, type, headsign, …} or null
    });

    // Colour by the operator of the matched line when we know it (more
    // specific than what the CSV product text gives us).
    const colour = OPERATOR_COLOUR[dbg.matchedOperator] ?? colourForOperator(trip.operator);

    const popupContent = buildPopup(trip, !!routeCoords, dep);

    // Thin visible line (pointer-events disabled so it never steals clicks)
    const line = L.polyline(latlngs, { color: colour, weight: 2.5, opacity: 0.65, interactive: false })
      .addTo(routeLayer);

    // Wide invisible hit area — makes the line easy to click/tap
    const hit = L.polyline(latlngs, { color: colour, weight: 16, opacity: 0 })
      .bindPopup(popupContent)
      .addTo(routeLayer);

    // Midpoint dot — unambiguous click target in operator colour
    const mid = latlngs[Math.floor(latlngs.length / 2)];
    const dot = L.circleMarker(mid, {
      radius: 7, color: '#fff', weight: 2, fillColor: colour, fillOpacity: 1,
    })
      .bindPopup(popupContent)
      .addTo(routeLayer);

    tripLayerIndex.push({
      dayNum: dayNumber(parseOVDate(trip.date)),
      layers: [line, hit, dot],
      visible: true,
    });

    // Heatmap accumulation: pool identical paths (direction-insensitive) and
    // count every stop visit.
    if (!isRoundTrip && latlngs.length > 1) {
      const k = heatKey(latlngs);
      const e = heatPaths.get(k);
      if (e) e.count++; else heatPaths.set(k, { latlngs, count: 1 });
    }
    if (routeCoords && !isRoundTrip) {
      coveragePaths.push({ latlngs, mode: statsMode });
    }
    const heatStopList = isRoundTrip
      ? [[trip.from, fromCoord]]
      : [[trip.from, fromCoord], [trip.to, toCoord]];
    for (const [name, c] of heatStopList) {
      const sk = `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;
      const e = heatStops.get(sk);
      if (e) e.count++; else heatStops.set(sk, { name, coord: c, count: 1 });
    }
  });

  if (shown > 0) {
    const bounds = routeLayer.getLayers()
      .filter((l) => l instanceof L.Polyline && l.options.interactive === false)
      .reduce((b, l) => b.extend(l.getBounds()), L.latLngBounds());
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }

  updateStats(trips, shown, missing, straightLine);
  renderTable(trips);
  renderDebugTable();
  OVStats.renderAll(statsRecords, { getPool: (mode) => OVMatch.getRoutePool([mode]) });
  renderHeatmap(heatPaths, heatStops);

  coverageData = { paths: coveragePaths, stops: [...heatStops.values()].map((s) => s.coord) };
  coverageStale = true;
  if (map.hasLayer(coverageLayer)) buildCoverageLayer();

  resetTimeline();
}

// ─── Coverage scratch map ─────────────────────────────────────────────────────
// 'Dekking (scratch map)' overlay: the full TRAIN/TRAM/METRO lijnnetkaart in
// faint grey with every travelled geometry lit up on top, plus dots for the
// visited stops. Rendered on a canvas — the base network is thousands of
// polylines, too many for the default SVG renderer. Built lazily on first
// enable and rebuilt when the rendered trip set changes.

const coverageRenderer = L.canvas({ padding: 0.5 });
let coverageStale = true;
let coverageData = { paths: [], stops: [] };

function buildCoverageLayer() {
  coverageLayer.clearLayers();

  for (const mode of ['TRAIN', 'TRAM', 'METRO']) {
    for (const route of OVMatch.getRoutePool([mode])) {
      if (!route.coords || route.coords.length < 2) continue;
      L.polyline(route.coords, {
        renderer: coverageRenderer,
        color: '#9aa6bf',
        weight: mode === 'TRAIN' ? 1.4 : 1,
        opacity: 0.5,
        interactive: false,
      }).addTo(coverageLayer);
    }
  }

  for (const { latlngs, mode } of coverageData.paths) {
    if (mode === 'BUS') continue; // the base layer shows rail networks only
    L.polyline(latlngs, {
      renderer: coverageRenderer,
      color: '#f59f00', weight: 3, opacity: 0.9, interactive: false,
    }).addTo(coverageLayer);
  }

  for (const c of coverageData.stops) {
    L.circleMarker([c.lat, c.lon], {
      renderer: coverageRenderer,
      radius: 3, stroke: false, fillColor: '#e8590c', fillOpacity: 0.9,
      interactive: false,
    }).addTo(coverageLayer);
  }

  coverageStale = false;
}

map.on('overlayadd', (e) => {
  if (e.layer === coverageLayer && coverageStale) buildCoverageLayer();
});

// ─── Heatmap ──────────────────────────────────────────────────────────────────
// Frequency overlay: every distinct path/stop is drawn once, coloured and
// weighted by how often it was travelled/visited (log scale). Lives in
// heatLayer, toggled via the layer control.

function heatKey(latlngs) {
  const r = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const [a, b] = [r(latlngs[0]), r(latlngs[latlngs.length - 1])].sort();
  return `${latlngs.length}|${a}|${b}`;
}

function heatColour(t) {
  const ramp = [[255, 213, 79], [251, 140, 0], [213, 0, 0]]; // yellow → orange → red
  const x = t * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const f = x - i;
  const c = ramp[i].map((v, k) => Math.round(v + (ramp[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function renderHeatmap(paths, stops) {
  heatLayer.clearLayers();

  const maxP = Math.max(1, ...[...paths.values()].map((p) => p.count));
  [...paths.values()]
    .sort((a, b) => a.count - b.count) // hottest paths drawn on top
    .forEach(({ latlngs, count }) => {
      const t = Math.log(count + 1) / Math.log(maxP + 1);
      L.polyline(latlngs, {
        color: heatColour(t),
        weight: 2.5 + 4.5 * t,
        opacity: 0.45 + 0.45 * t,
        interactive: false,
      }).addTo(heatLayer);
    });

  const maxS = Math.max(1, ...[...stops.values()].map((s) => s.count));
  for (const { name, coord, count } of stops.values()) {
    const t = Math.log(count + 1) / Math.log(maxS + 1);
    L.circleMarker([coord.lat, coord.lon], {
      radius: 3 + 5 * t,
      stroke: false,
      fillColor: heatColour(t),
      fillOpacity: 0.8,
    })
      .bindPopup(`<strong>${name}</strong><br>${count} bezoek${count === 1 ? '' : 'en'}`)
      .addTo(heatLayer);
  }
}

// ─── Journey helpers ──────────────────────────────────────────────────────────

function journeyMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  let mins = OVMatch.timeToMins(checkOut) - OVMatch.timeToMins(checkIn);
  if (mins < 0) mins += 1440; // overnight
  return mins > 0 ? mins : null;
}

function formatDuration(mins) {
  if (mins === null) return '';
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}u ${mins % 60}min`;
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function buildPopup(trip, hasRealRoute, dep) {
  const cost      = trip.fare ?? trip.amount ?? 0;
  const amountStr = cost > 0 ? `€${cost.toFixed(2)}` : '';
  const isDebit   = trip.debit === 'Af' || trip.fare > 0;
  const dir       = isDebit ? '💸' : (amountStr ? '↩' : '');
  const mins      = journeyMinutes(trip.checkIn, trip.checkOut);
  const durStr    = mins ? ` · <em>${formatDuration(mins)}</em>` : '';
  const routeMark = hasRealRoute ? '' : ' <span title="Echte route niet beschikbaar">〜</span>';

  const depStr = dep
    ? `<br><em>waarschijnlijk de ${dep.dep} ${dep.type} richting ${dep.headsign}</em>`
    : '';

  return `
    <strong>${trip.from}</strong> → <strong>${trip.to}</strong>${routeMark}<br>
    ${trip.date} &nbsp;${trip.checkIn}–${trip.checkOut}${durStr}<br>
    ${trip.operator} &nbsp;${trip.product ?? trip.modalType ?? ''}${depStr}<br>
    ${dir} ${amountStr}
  `.trim();
}

// ─── Table rendering ──────────────────────────────────────────────────────────

function renderTable(trips) {
  const tbody = document.getElementById('trips-tbody');
  tbody.innerHTML = '';

  trips.forEach((trip) => {
    const cost    = trip.fare ?? trip.amount ?? 0;
    const isDebit = trip.debit === 'Af' || trip.fare > 0;
    const amountStr = cost > 0
      ? `€${cost.toFixed(2)}`
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${trip.date ?? ''}</td>
      <td>${trip.checkIn ?? ''}</td>
      <td>${trip.from ?? ''}</td>
      <td>${trip.checkOut ?? ''}</td>
      <td>${trip.to ?? ''}</td>
      <td class="${amountStr ? (isDebit ? 'amount-debit' : 'amount-credit') : ''}">${amountStr}</td>
      <td>${trip.product ?? ''}</td>
      <td>
        <span class="operator-dot" style="background:${colourForOperator(trip.operator)}"></span>
        ${trip.operator ?? ''}
      </td>
      <td>${trip.card ?? ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Debug table ─────────────────────────────────────────────────────────────

function renderDebugTable() {
  const tbody = document.getElementById('debug-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  routeDebugLog.forEach((d) => {
    const resultClass = (d.result === 'echte route' || d.result === 'gtfs route' || d.result === 'rondrit') ? 'dbg-ok'
      : d.result === 'rechte lijn' ? 'dbg-warn'
      : 'dbg-err';

    const matchLabel = d.matchedRoute
      ? d.matchedRoute + (d.matchedOperator ? ` (${d.matchedOperator})` : '')
      : null;
    const matchCell = matchLabel
      ? `<span title="${matchLabel}">${matchLabel.slice(0, 40)}${matchLabel.length > 40 ? '…' : ''}</span>`
      : '—';

    const scoreCell = d.score !== null ? d.score.toExponential(2) : '—';

    const pcCell = d.publicCode ?? '—';

    const stopCell = (found, name) =>
      found ? `<span class="dbg-ok-dot">✓</span> ${name}`
             : `<span class="dbg-err-dot">✗</span> <em>${name}</em>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.date ?? ''}</td>
      <td class="dbg-num">${d.checkIn}</td>
      <td class="dbg-num">${d.checkOut}</td>
      <td>${d.from}</td>
      <td>${d.to}</td>
      <td>${d.operator ?? '?'}</td>
      <td class="dbg-product">${d.product}</td>
      <td>${stopCell(d.fromFound, d.from)}</td>
      <td>${stopCell(d.toFound, d.to)}</td>
      <td class="dbg-num">${d.poolSize}</td>
      <td>${pcCell}</td>
      <td class="dbg-num">${d.narrowedSize || d.poolSize}</td>
      <td>${d.gtfsMatch ?? '—'}</td>
      <td class="dbg-match">${matchCell}</td>
      <td class="dbg-num">${scoreCell}</td>
      <td class="dbg-num">${d.fromIdx !== null ? d.fromIdx : '—'}</td>
      <td class="dbg-num">${d.toIdx   !== null ? d.toIdx   : '—'}</td>
      <td class="dbg-num">${d.routePts !== null ? d.routePts : '—'}</td>
      <td><span class="dbg-badge ${resultClass}">${d.result}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function updateStats(trips, shown, missing, straightLine) {
  const totalSpend = trips
    .reduce((s, t) => s + (t.fare ?? (t.debit === 'Af' ? t.amount : 0) ?? 0), 0);

  const operators = [...new Set(trips.map((t) => t.operator))].join(', ');

  document.getElementById('stats').innerHTML = `
    <strong>${trips.length}</strong> ritten &nbsp;|&nbsp;
    <strong>€${totalSpend.toFixed(2)}</strong> totaal &nbsp;|&nbsp;
    ${missing > 0 ? `<span title="Stop niet gevonden in dataset">${missing} niet op kaart</span> &nbsp;|&nbsp;` : ''}
    ${straightLine > 0 ? `<span title="Rechte lijn getoond; echte route niet gevonden">${straightLine} &times; rechte lijn</span> &nbsp;|&nbsp;` : ''}
    ${operators}
  `;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function buildLegend(trips) {
  const usedOps = [...new Set(trips.map((t) => t.operator))];
  const legend = document.createElement('div');
  legend.id = 'legend';
  legend.innerHTML = usedOps
    .map((op) => `<div><span class="dot" style="background:${colourForOperator(op)}"></span>${op}</div>`)
    .join('');
  document.body.appendChild(legend);
}

// ─── Date filter ─────────────────────────────────────────────────────────────

function parseOVDate(str) {
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  if (parts[0].length === 4) return new Date(str);
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}

function applyFilter() {
  const fromVal = document.getElementById('date-from').value;
  const toVal   = document.getElementById('date-to').value;

  const from = fromVal ? new Date(fromVal) : null;
  const to   = toVal   ? new Date(toVal)   : null;
  if (to) to.setHours(23, 59, 59);

  const filtered = allTrips.filter((trip) => {
    const d = parseOVDate(trip.date);
    if (!d) return true;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });

  renderTrips(filtered);
}

function setPreset(days) {
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  document.getElementById('date-from').value = from.toISOString().slice(0, 10);
  document.getElementById('date-to').value   = to.toISOString().slice(0, 10);

  document.querySelectorAll('.btn-preset').forEach((b) =>
    b.classList.toggle('active', +b.dataset.days === days)
  );

  applyFilter();
}

document.querySelectorAll('.btn-preset').forEach((btn) => {
  btn.addEventListener('click', () => setPreset(+btn.dataset.days));
});

document.getElementById('btn-apply').addEventListener('click', () => {
  document.querySelectorAll('.btn-preset').forEach((b) => b.classList.remove('active'));
  applyFilter();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value   = '';
  document.querySelectorAll('.btn-preset').forEach((b) => b.classList.remove('active'));
  renderTrips(allTrips);
});

// ─── Timeline ─────────────────────────────────────────────────────────────────
// Full-width bar at the bottom of the map: an intensity graph (ritten per dag)
// over the whole rendered period, with a draggable highlight window the width
// of the chosen periode (week/maand). ▶ sweeps the window across the period at
// the selected speed; trips outside the window fade out via the CSS transition
// on stroke/fill-opacity (style.css).

const tlGraph  = document.getElementById('tl-graph');
const tlSvg    = document.getElementById('tl-svg');
const tlWindow = document.getElementById('tl-window');
const tlLabel  = document.getElementById('tl-label');
const tlPlay   = document.getElementById('tl-play');
const tlSpeed  = document.getElementById('tl-speed');

const timeline = {
  active: false,    // false = window disengaged, all trips visible
  playing: false,
  timer: null,
  startDay: null,   // UTC day numbers spanning the rendered trips
  endDay: null,
  windowDays: 7,
  pos: 0,           // window offset in days from startDay
  msPerDay: +tlSpeed.value || 180,
};

function dayNumber(date) {
  return date
    ? Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5)
    : null;
}

function fmtDay(dayNum) {
  return new Date(dayNum * 864e5)
    .toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timelineSpan() {
  return timeline.startDay === null ? 0 : timeline.endDay - timeline.startDay + 1;
}

function timelineMax() {
  return Math.max(0, timelineSpan() - timeline.windowDays);
}

// Called from renderTrips: the trip set (and thus the period) changed.
function resetTimeline() {
  stopTimelinePlay();
  timeline.active = false;
  timeline.pos = 0;
  const days = tripLayerIndex.map((e) => e.dayNum).filter((d) => d !== null);
  timeline.startDay = days.length ? Math.min(...days) : null;
  timeline.endDay   = days.length ? Math.max(...days) : null;
  tlLabel.textContent = 'Hele periode';
  buildTimelineGraph();
  updateTimelineWindowEl();
  document.getElementById('timeline').classList.toggle('hidden', timeline.startDay === null);
  map.invalidateSize(); // the bar shares the tab with the map (flex column)
}

// Intensity graph: ritten per dag over the whole period as an SVG area + line,
// stretched to the full bar width (1 SVG unit per day, preserveAspectRatio=none).
function buildTimelineGraph() {
  const span = timelineSpan();
  if (!span) { tlSvg.innerHTML = ''; return; }

  const counts = new Array(span).fill(0);
  for (const e of tripLayerIndex) {
    if (e.dayNum !== null) counts[e.dayNum - timeline.startDay]++;
  }

  const H = 40;
  const max = Math.max(1, ...counts);
  const y = (c) => (H - 2 - (c / max) * (H - 6)).toFixed(2);
  const pts = counts.map((c, i) => `${i + 0.5},${y(c)}`);

  tlSvg.setAttribute('viewBox', `0 0 ${span} ${H}`);
  tlSvg.innerHTML =
    `<path d="M0,${H} L${pts.join(' L')} L${span},${H} Z" fill="rgba(0,48,130,0.18)"/>` +
    `<path d="M${pts.join(' L')}" fill="none" stroke="#003082" stroke-width="1.5"
       vector-effect="non-scaling-stroke"/>`;
}

function updateTimelineWindowEl() {
  const span = timelineSpan();
  if (!timeline.active || !span) { tlWindow.classList.add('hidden'); return; }
  tlWindow.classList.remove('hidden');
  tlWindow.style.left  = `${(timeline.pos / span) * 100}%`;
  tlWindow.style.width = `${(Math.min(timeline.windowDays, span) / span) * 100}%`;
}

function setTripVisible(entry, vis) {
  if (entry.visible === vis) return;
  entry.visible = vis;
  const [line, hit, dot] = entry.layers;
  line.setStyle({ opacity: vis ? 0.65 : 0 });
  dot.setStyle({ opacity: vis ? 1 : 0, fillOpacity: vis ? 1 : 0 });
  // The hit area stays invisible either way; disable its pointer events so
  // faded-out trips can't be clicked.
  for (const l of [hit, dot]) {
    const el = l.getElement && l.getElement();
    if (el) el.style.pointerEvents = vis ? '' : 'none';
  }
}

function applyTimelineWindow() {
  const from = timeline.startDay + timeline.pos;
  const to   = from + timeline.windowDays - 1; // inclusive
  tlLabel.textContent = `${fmtDay(from)} – ${fmtDay(to)}`;
  updateTimelineWindowEl();
  tripLayerIndex.forEach((e) =>
    setTripVisible(e, e.dayNum !== null && e.dayNum >= from && e.dayNum <= to));
}

function setTimelinePos(p) {
  timeline.active = true;
  timeline.pos = Math.max(0, Math.min(timelineMax(), Math.round(p)));
  applyTimelineWindow();
}

function exitTimeline() {
  stopTimelinePlay();
  timeline.active = false;
  timeline.pos = 0;
  tlLabel.textContent = 'Hele periode';
  updateTimelineWindowEl();
  tripLayerIndex.forEach((e) => setTripVisible(e, true));
}

function stopTimelinePlay() {
  timeline.playing = false;
  if (timeline.timer) { clearInterval(timeline.timer); timeline.timer = null; }
  if (tlPlay) tlPlay.textContent = '▶';
}

function timelineTick() {
  if (timeline.pos >= timelineMax()) { stopTimelinePlay(); return; }
  timeline.pos++;
  applyTimelineWindow();
}

function startTimelinePlay() {
  if (timeline.startDay === null) return;
  if (!timeline.active || timeline.pos >= timelineMax()) timeline.pos = 0; // (re)start
  timeline.active = true;
  timeline.playing = true;
  tlPlay.textContent = '⏸';
  applyTimelineWindow();
  timeline.timer = setInterval(timelineTick, timeline.msPerDay);
}

tlPlay.addEventListener('click', () =>
  timeline.playing ? stopTimelinePlay() : startTimelinePlay());

// Drag the window across the graph, or click the graph to centre it there.
// Pointer capture keeps the drag alive when the cursor leaves the bar.
let tlDragOffset = null;

function dayAtClientX(x) {
  const r = tlGraph.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (x - r.left) / r.width));
  return timeline.startDay + t * timelineSpan();
}

tlGraph.addEventListener('pointerdown', (e) => {
  if (timeline.startDay === null) return;
  stopTimelinePlay();
  if (e.target !== tlWindow) {
    setTimelinePos(dayAtClientX(e.clientX) - timeline.startDay - timeline.windowDays / 2);
  }
  tlDragOffset = dayAtClientX(e.clientX) - (timeline.startDay + timeline.pos);
  tlGraph.setPointerCapture(e.pointerId);
  e.preventDefault();
});

tlGraph.addEventListener('pointermove', (e) => {
  if (tlDragOffset === null) return;
  setTimelinePos(dayAtClientX(e.clientX) - timeline.startDay - tlDragOffset);
});

tlGraph.addEventListener('pointerup',     () => { tlDragOffset = null; });
tlGraph.addEventListener('pointercancel', () => { tlDragOffset = null; });

document.querySelectorAll('.tl-win').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tl-win').forEach((b) => b.classList.toggle('active', b === btn));
    timeline.windowDays = +btn.dataset.days;
    timeline.pos = Math.min(timeline.pos, timelineMax());
    if (timeline.active) applyTimelineWindow();
  });
});

tlSpeed.addEventListener('change', () => {
  timeline.msPerDay = +tlSpeed.value || 180;
  if (timeline.playing) { // restart the ticker at the new pace
    clearInterval(timeline.timer);
    timeline.timer = setInterval(timelineTick, timeline.msPerDay);
  }
});

document.getElementById('tl-reset').addEventListener('click', exitTimeline);

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));

    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');

    // Leaflet needs a size recalc when its container becomes visible
    if (tab.dataset.tab === 'map') map.invalidateSize();
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadStations(), loadRoutes(), loadSchedules()]);

  chrome.storage.local.get(['trips', 'fetchedAt'], ({ trips, fetchedAt }) => {
    if (!trips || trips.length === 0) {
      document.getElementById('no-data').classList.remove('hidden');
      return;
    }

    // Fold Check-in rows into their journey rows (gives journeys a check-in
    // time) and recompute the operator — cached trips may carry inference
    // results from an older extension version.
    allTrips = OVMatch.mergeJourneys(trips);
    allTrips.forEach(OVMatch.refreshTripInference);

    const dates = allTrips.map((t) => parseOVDate(t.date)).filter(Boolean);
    if (dates.length) {
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      document.getElementById('date-from').value = minDate.toISOString().slice(0, 10);
      document.getElementById('date-to').value   = maxDate.toISOString().slice(0, 10);
    }

    buildLegend(allTrips);
    renderTrips(allTrips);

    if (fetchedAt) {
      const age = Math.round((Date.now() - fetchedAt) / 3600000);
      console.info(`[OVerzicht] data ${age}h old, ${allTrips.length} ritten na samenvoegen`);
    }
  });
}

init();
