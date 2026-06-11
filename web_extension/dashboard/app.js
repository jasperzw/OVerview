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

L.control.layers(
  null,
  { 'Spoorwegen (OpenRailwayMap)': ormLayer },
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

let routeLayer = L.layerGroup().addTo(map);
let allTrips = [];
let routeDebugLog = [];

function renderTrips(trips) {
  routeLayer.clearLayers();
  routeDebugLog = [];

  let shown = 0;
  let missing = 0;
  let straightLine = 0;

  trips.forEach((trip) => {
    if (!trip.from || !trip.to) return;

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

    // Colour by the operator of the matched line when we know it (more
    // specific than what the CSV product text gives us).
    const colour = OPERATOR_COLOUR[dbg.matchedOperator] ?? colourForOperator(trip.operator);

    const popupContent = buildPopup(trip, !!routeCoords, dep);

    // Thin visible line (pointer-events disabled so it never steals clicks)
    L.polyline(latlngs, { color: colour, weight: 2.5, opacity: 0.65, interactive: false })
      .addTo(routeLayer);

    // Wide invisible hit area — makes the line easy to click/tap
    L.polyline(latlngs, { color: colour, weight: 16, opacity: 0 })
      .bindPopup(popupContent)
      .addTo(routeLayer);

    // Midpoint dot — unambiguous click target in operator colour
    const mid = latlngs[Math.floor(latlngs.length / 2)];
    L.circleMarker(mid, {
      radius: 7, color: '#fff', weight: 2, fillColor: colour, fillOpacity: 1,
    })
      .bindPopup(popupContent)
      .addTo(routeLayer);
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
