// ─── Statistics tabs ──────────────────────────────────────────────────────────
// Renders the Statistieken / Kosten / Gewoontes tabs from the per-trip records
// app.js assembles while rendering the map (trip + matched route geometry).
// Browser global OVStats; no Leaflet and no matching logic lives here.

(function (root) {
  'use strict';

  const NL_LENGTH_KM = 300; // the Netherlands measures ±300 km north–south

  const MODE_LABEL = {
    TRAIN: 'Trein',
    BUS:   'Bus',
    TRAM:  'Tram',
    METRO: 'Metro',
    BTM:   'Bus/tram/metro',
  };

  const DAY_LABEL = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function pathKm(latlngs) {
    if (!latlngs || latlngs.length < 2) return 0;
    let km = 0;
    for (let i = 1; i < latlngs.length; i++) km += haversineKm(latlngs[i - 1], latlngs[i]);
    return km;
  }

  function tripMinutes(trip) {
    if (!trip.checkIn || !trip.checkOut) return null;
    let mins = OVMatch.timeToMins(trip.checkOut) - OVMatch.timeToMins(trip.checkIn);
    if (mins < 0) mins += 1440; // overnight
    return mins > 0 ? mins : null;
  }

  function fmtKm(km) {
    return (km >= 100 ? Math.round(km).toLocaleString('nl-NL') : km.toFixed(1)) + ' km';
  }

  function fmtEur(x) {
    return `€${x.toFixed(2)}`;
  }

  function fmtDur(mins) {
    if (mins == null) return '—';
    mins = Math.round(mins);
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}u ${mins % 60}min`;
  }

  function sum(list, fn) {
    return list.reduce((s, x) => s + (fn(x) || 0), 0);
  }

  function groupBy(list, keyFn) {
    const m = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (k === null || k === undefined) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' });
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ─── HTML building blocks ───────────────────────────────────────────────────

  function cards(items) {
    return '<div class="stat-cards">' + items.map((c) => `
      <div class="stat-card">
        <div class="stat-value">${c.value}</div>
        <div class="stat-label">${c.label}</div>
        ${c.sub ? `<div class="stat-sub">${c.sub}</div>` : ''}
      </div>`).join('') + '</div>';
  }

  function section(title, body, note) {
    return `<section class="stats-section">
      <h2>${title}</h2>${body}
      ${note ? `<p class="stats-note">${note}</p>` : ''}
    </section>`;
  }

  // Cells may be a string or { v, num: true } for right-aligned numerics.
  function table(headers, rows) {
    const cell = (c, tag) => {
      const isObj = c !== null && typeof c === 'object';
      return `<${tag}${isObj && c.num ? ' class="num"' : ''}>${isObj ? c.v : c}</${tag}>`;
    };
    return `<table class="stats-table">
      <thead><tr>${headers.map((h) => cell(h, 'th')).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody>
    </table>`;
  }

  function barChart(items, fmt) {
    const max = Math.max(0, ...items.map((i) => i.value));
    if (max <= 0) return '<p class="stats-note">Geen gegevens.</p>';
    return '<div class="bar-chart">' + items.map((i) => `
      <div class="bar-row">
        <span class="bar-label">${i.label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${((i.value / max) * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${fmt(i.value)}${i.sub ? ` <em>${i.sub}</em>` : ''}</span>
      </div>`).join('') + '</div>';
  }

  // ─── Record enrichment ──────────────────────────────────────────────────────
  // app.js records: { trip, latlngs, geometric, isRoundTrip, mode }

  function enrich(records) {
    return records.map((r) => {
      const t = r.trip;
      const cost = t.fare ?? t.amount ?? 0;
      const isDebit = t.debit === 'Af' || t.fare > 0;
      return {
        ...r,
        km:     r.isRoundTrip ? 0 : pathKm(r.latlngs),
        mins:   tripMinutes(t),
        spend:  isDebit ? cost : 0,
        credit: isDebit ? 0 : cost,
        date:   OVMatch.parseOVDate(t.date),
      };
    });
  }

  const isJourney = (r) => !!(r.trip.from && r.trip.to);

  // ─── Network coverage (scratch map) ─────────────────────────────────────────
  // The country is rasterised into ~280 m cells. A mode's network size is the
  // number of distinct cells its lijnnetkaart lines pass through — which also
  // de-duplicates parallel routes over the same track or street — and coverage
  // is the fraction of those cells the travelled geometries touch (±1 cell of
  // tolerance, because GTFS shapes and lijnnetkaart lines for the same track
  // are drawn slightly apart).

  const COV_CELL    = 0.0025;  // degrees latitude ≈ 280 m
  const COV_LONF    = 0.629;   // cos 51° — degree-space lon correction
  const COV_CELL_KM = 0.28;    // km of line one cell roughly represents
  const COV_MODES   = ['TRAIN', 'TRAM', 'METRO', 'BUS'];

  // The lijnnetkaart includes international stretches (ICE to Frankfurt, IC to
  // Brussels); clip to the Netherlands so "het Nederlandse spoornet" is honest.
  const COV_NL = { latMin: 50.7, latMax: 53.6, lonMin: 3.3, lonMax: 7.25 };
  const _inNL = (lat, lon) =>
    lat >= COV_NL.latMin && lat <= COV_NL.latMax && lon >= COV_NL.lonMin && lon <= COV_NL.lonMax;

  let _netCellsCache = null; // the network is static for the session

  function _forEachSample(coords, cb) {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const n = Math.max(1, Math.ceil(haversineKm(a, b) / 0.15));
      for (let s = 0; s < n; s++) {
        cb(a[0] + (b[0] - a[0]) * (s / n), a[1] + (b[1] - a[1]) * (s / n));
      }
    }
    const last = coords[coords.length - 1];
    cb(last[0], last[1]);
  }

  function _networkCells(getPool) {
    if (_netCellsCache) return _netCellsCache;
    _netCellsCache = {};
    for (const mode of COV_MODES) {
      const cells = new Set();
      for (const route of getPool(mode)) {
        if (!route.coords || route.coords.length < 2) continue;
        _forEachSample(route.coords, (lat, lon) => {
          if (_inNL(lat, lon)) {
            cells.add(`${Math.round(lat / COV_CELL)}:${Math.round((lon * COV_LONF) / COV_CELL)}`);
          }
        });
      }
      _netCellsCache[mode] = cells;
    }
    return _netCellsCache;
  }

  function computeCoverage(records, getPool) {
    const net = _networkCells(getPool);

    const travelled = Object.fromEntries(COV_MODES.map((m) => [m, new Set()]));
    for (const r of records) {
      if (!r.geometric || !r.latlngs) continue;
      const sets = r.mode === 'BTM'
        ? [travelled.BUS, travelled.TRAM, travelled.METRO]
        : travelled[r.mode] ? [travelled[r.mode]] : [];
      if (!sets.length) continue;
      _forEachSample(r.latlngs, (lat, lon) => {
        const ci = Math.round(lat / COV_CELL);
        const cj = Math.round((lon * COV_LONF) / COV_CELL);
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const k = `${ci + di}:${cj + dj}`;
            for (const s of sets) s.add(k);
          }
        }
      });
    }

    const out = {};
    for (const mode of COV_MODES) {
      let covered = 0;
      for (const c of net[mode]) if (travelled[mode].has(c)) covered++;
      out[mode] = {
        networkKm: net[mode].size * COV_CELL_KM,
        coveredKm: covered * COV_CELL_KM,
        pct: net[mode].size ? (covered / net[mode].size) * 100 : 0,
      };
    }
    return out;
  }

  function coverageSection(recs, getPool) {
    const cov = computeCoverage(recs, getPool);
    const rows = COV_MODES
      .filter((m) => cov[m].networkKm > 0)
      .map((m) => [
        MODE_LABEL[m],
        { v: fmtKm(cov[m].networkKm), num: true },
        { v: fmtKm(cov[m].coveredKm), num: true },
        { v: `${cov[m].pct.toFixed(1)}%`, num: true },
      ]);
    if (!rows.length) return '';

    const headline = cov.TRAIN.networkKm > 0
      ? `<p class="stats-headline">Je hebt ≈${cov.TRAIN.pct.toFixed(1)}% van het Nederlandse spoornet bereisd.</p>`
      : '';

    return section('Netwerkdekking',
      headline + table(
        ['Modus', { v: 'Netwerk', num: true }, { v: 'Bereisd', num: true }, { v: 'Dekking', num: true }],
        rows),
      'Geschat op een raster van ±280 m-cellen; parallelle lijnen over hetzelfde spoor of ' +
      'dezelfde straat tellen één keer. Zet de kaartlaag "Dekking (scratch map)" aan om het ' +
      'bereisde netwerk op de kaart te zien.');
  }

  function speedRows(group) {
    // km/h over the trips in a group that have both a route and check-in/out times
    const timed = group.filter((r) => r.km > 0 && r.mins);
    const mins = sum(timed, (r) => r.mins);
    return mins > 0 ? (sum(timed, (r) => r.km) / mins) * 60 : null;
  }

  function monthBars(groups, valueFn, fmt, subFn) {
    return barChart(
      [...groups.keys()].sort().map((k) => ({
        label: monthLabel(k),
        value: valueFn(groups.get(k)),
        sub: subFn ? subFn(groups.get(k)) : null,
      })),
      fmt
    );
  }

  // ─── Tab 1: Statistieken (totals) ───────────────────────────────────────────

  function renderTotals(recs, getPool) {
    const el = document.getElementById('stats-totals');
    if (!el) return;

    const journeys  = recs.filter(isJourney);
    const totalKm   = sum(journeys, (r) => r.km);
    const totalMins = sum(journeys, (r) => r.mins);
    const timed     = journeys.filter((r) => r.mins);
    const avgSpeed  = speedRows(journeys);

    const nlTimes = totalKm / NL_LENGTH_KM;
    const straight = journeys.filter((r) => r.latlngs && !r.geometric && !r.isRoundTrip).length;
    const noRoute  = journeys.filter((r) => !r.latlngs && !r.isRoundTrip).length;

    const head = cards([
      {
        value: fmtKm(totalKm),
        label: 'Totale afstand',
        sub: nlTimes >= 1
          ? `${nlTimes.toFixed(1)}× de lengte van Nederland`
          : `${Math.round(nlTimes * 100)}% van de lengte van Nederland`,
      },
      { value: journeys.length, label: 'Ritten' },
      {
        value: fmtDur(totalMins),
        label: 'Reistijd',
        sub: timed.length ? `gem. ${fmtDur(totalMins / timed.length)} per rit` : '',
      },
      {
        value: avgSpeed ? `${avgSpeed.toFixed(0)} km/u` : '—',
        label: 'Gemiddelde snelheid',
        sub: 'ritten met route én in-/uitchecktijd',
      },
    ]);

    const modeRows = [...groupBy(journeys, (r) => r.mode ?? '?').entries()]
      .sort((a, b) => sum(b[1], (r) => r.km) - sum(a[1], (r) => r.km))
      .map(([mode, g]) => {
        const speed = speedRows(g);
        return [
          MODE_LABEL[mode] ?? mode,
          { v: g.length, num: true },
          { v: fmtKm(sum(g, (r) => r.km)), num: true },
          { v: fmtDur(sum(g, (r) => r.mins)), num: true },
          { v: speed ? `${speed.toFixed(0)} km/u` : '—', num: true },
        ];
      });

    const opRows = [...groupBy(journeys, (r) => r.trip.operator ?? 'OV').entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([op, g]) => [
        esc(op),
        { v: g.length, num: true },
        { v: fmtKm(sum(g, (r) => r.km)), num: true },
        { v: fmtDur(sum(g, (r) => r.mins)), num: true },
      ]);

    const distNote = [
      straight ? `${straight} rit(ten) zonder gematchte route tellen hemelsbreed mee.` : '',
      noRoute  ? `${noRoute} rit(ten) zonder stop-locatie tellen niet mee in de afstand.` : '',
    ].filter(Boolean).join(' ');

    el.innerHTML = head +
      section('Per vervoermiddel',
        table(['Modus', { v: 'Ritten', num: true }, { v: 'Afstand', num: true }, { v: 'Reistijd', num: true }, { v: 'Gem. snelheid', num: true }], modeRows),
        distNote) +
      section('Per vervoerder',
        table(['Vervoerder', { v: 'Ritten', num: true }, { v: 'Afstand', num: true }, { v: 'Reistijd', num: true }], opRows)) +
      (getPool ? coverageSection(journeys, getPool) : '') +
      section('Afstand per maand',
        monthBars(groupBy(journeys.filter((r) => r.date), (r) => monthKey(r.date)),
          (g) => sum(g, (r) => r.km), fmtKm,
          (g) => `${g.length} ritten`));
  }

  // ─── Tab 2: Kosten ──────────────────────────────────────────────────────────

  function renderCosts(recs) {
    const el = document.getElementById('stats-costs');
    if (!el) return;

    const journeys   = recs.filter(isJourney);
    const totalSpend = sum(recs, (r) => r.spend);
    const credits    = recs.filter((r) => r.credit > 0);
    const paid       = journeys.filter((r) => r.spend > 0);

    const priced = journeys.filter((r) => r.spend > 0 && r.km > 0);
    const perKm  = priced.length ? sum(priced, (r) => r.spend) / sum(priced, (r) => r.km) : null;

    const head = cards([
      { value: fmtEur(totalSpend), label: 'Totaal uitgegeven' },
      {
        value: paid.length ? fmtEur(totalSpend / paid.length) : '—',
        label: 'Gemiddeld per betaalde rit',
        sub: `${paid.length} betaalde ritten`,
      },
      {
        value: perKm ? `${fmtEur(perKm)}/km` : '—',
        label: 'Prijs per kilometer',
        sub: 'betaalde ritten met route',
      },
      {
        value: fmtEur(sum(credits, (r) => r.credit)),
        label: 'Bijgeschreven',
        sub: `${credits.length} transacties`,
      },
    ]);

    const perKmOf = (g) => {
      const p = g.filter((r) => r.spend > 0 && r.km > 0);
      return p.length ? fmtEur(sum(p, (r) => r.spend) / sum(p, (r) => r.km)) + '/km' : '—';
    };

    const opRows = [...groupBy(journeys, (r) => r.trip.operator ?? 'OV').entries()]
      .sort((a, b) => sum(b[1], (r) => r.spend) - sum(a[1], (r) => r.spend))
      .map(([op, g]) => [
        esc(op),
        { v: g.length, num: true },
        { v: fmtEur(sum(g, (r) => r.spend)), num: true },
        { v: perKmOf(g), num: true },
      ]);

    const modeRows = [...groupBy(journeys, (r) => r.mode ?? '?').entries()]
      .sort((a, b) => sum(b[1], (r) => r.spend) - sum(a[1], (r) => r.spend))
      .map(([mode, g]) => [
        MODE_LABEL[mode] ?? mode,
        { v: g.length, num: true },
        { v: fmtEur(sum(g, (r) => r.spend)), num: true },
        { v: perKmOf(g), num: true },
      ]);

    const expensive = [...journeys]
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)
      .map((r) => [
        esc(r.trip.date),
        `${esc(r.trip.from)} → ${esc(r.trip.to)}`,
        esc(r.trip.product ?? ''),
        { v: fmtEur(r.spend), num: true },
      ]);

    const byMonth = groupBy(recs.filter((r) => r.date), (r) => monthKey(r.date));
    let running = 0;
    const monthItems = [...byMonth.keys()].sort().map((k) => {
      const v = sum(byMonth.get(k), (r) => r.spend);
      running += v;
      return { label: monthLabel(k), value: v, sub: `totaal ${fmtEur(running)}` };
    });

    el.innerHTML = head +
      section('Per vervoerder',
        table(['Vervoerder', { v: 'Ritten', num: true }, { v: 'Uitgegeven', num: true }, { v: 'Prijs/km', num: true }], opRows)) +
      section('Per vervoermiddel',
        table(['Modus', { v: 'Ritten', num: true }, { v: 'Uitgegeven', num: true }, { v: 'Prijs/km', num: true }], modeRows)) +
      section('Duurste ritten',
        table(['Datum', 'Rit', 'Product', { v: 'Bedrag', num: true }], expensive)) +
      section('Uitgaven per maand', barChart(monthItems, fmtEur));
  }

  // ─── Tab 3: Gewoontes ───────────────────────────────────────────────────────

  function punchcard(recs) {
    const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    for (const r of recs) {
      if (!r.date || !r.trip.checkIn) continue;
      const day  = (r.date.getDay() + 6) % 7; // Monday first
      const hour = Math.floor(OVMatch.timeToMins(r.trip.checkIn) / 60) % 24;
      counts[day][hour]++;
      if (counts[day][hour] > max) max = counts[day][hour];
    }
    if (max === 0) return '<p class="stats-note">Geen check-in-tijden beschikbaar.</p>';

    const hourHead = Array.from({ length: 24 }, (_, h) =>
      `<span class="pc-hour">${h % 3 === 0 ? h : ''}</span>`).join('');

    const rows = counts.map((row, d) =>
      `<span class="pc-day">${DAY_LABEL[d]}</span>` + row.map((c, h) => {
        const alpha = 0.12 + 0.88 * (c / max);
        const fill = c === 0 ? '' : ` style="background:rgba(0,48,130,${alpha.toFixed(2)})"`;
        return `<span class="pc-cell"${fill}
          title="${DAY_LABEL[d]} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 · ${c} check-in(s)"></span>`;
      }).join('')
    ).join('');

    return `<div class="punchcard"><span class="pc-day"></span>${hourHead}${rows}</div>`;
  }

  function longestStreak(recs) {
    const days = [...new Set(recs
      .filter((r) => r.date)
      .map((r) => Date.UTC(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()) / 86400000)
    )].sort((a, b) => a - b);
    if (!days.length) return null;

    let best = { len: 1, end: days[0] };
    let len = 1;
    for (let i = 1; i < days.length; i++) {
      len = days[i] === days[i - 1] + 1 ? len + 1 : 1;
      if (len > best.len) best = { len, end: days[i] };
    }
    const fmt = (d) => new Date(d * 86400000).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
    return { len: best.len, from: fmt(best.end - best.len + 1), to: fmt(best.end) };
  }

  function renderHabits(recs) {
    const el = document.getElementById('stats-habits');
    if (!el) return;

    const journeys = recs.filter(isJourney);

    // Undirected origin–destination pairs
    const pairs = groupBy(journeys.filter((r) => r.trip.from !== r.trip.to),
      (r) => [r.trip.from, r.trip.to].sort().join(' ↔ '));
    const topPairs = [...pairs.entries()].sort((a, b) => b[1].length - a[1].length);

    // Station visits: departure and destination both count
    const visits = new Map();
    for (const r of journeys) {
      for (const stop of [r.trip.from, r.trip.to]) {
        if (stop) visits.set(stop, (visits.get(stop) ?? 0) + 1);
      }
    }
    const topStops = [...visits.entries()].sort((a, b) => b[1] - a[1]);

    const streak = longestStreak(journeys);

    const byDay = [...groupBy(journeys, (r) => r.trip.date).entries()]
      .sort((a, b) => b[1].length - a[1].length)[0];

    const head = cards([
      {
        value: topPairs.length ? `${topPairs[0][1].length}×` : '—',
        label: 'Drukste traject',
        sub: topPairs.length ? esc(topPairs[0][0]) : '',
      },
      {
        value: streak ? `${streak.len} dagen` : '—',
        label: 'Langste reeks reisdagen',
        sub: streak && streak.len > 1 ? `${streak.from} – ${streak.to}` : '',
      },
      {
        value: byDay ? `${byDay[1].length} ritten` : '—',
        label: 'Drukste dag',
        sub: byDay ? esc(byDay[0]) : '',
      },
      { value: visits.size, label: 'Unieke stations & haltes' },
    ]);

    // Records: clock-time extremes and longest journeys
    const withCi = recs.filter((r) => r.trip.checkIn);
    const byCi = (r) => OVMatch.timeToMins(r.trip.checkIn);
    const earliest = withCi.length ? withCi.reduce((a, b) => (byCi(a) <= byCi(b) ? a : b)) : null;
    const latest   = withCi.length ? withCi.reduce((a, b) => (byCi(a) >= byCi(b) ? a : b)) : null;
    const longest  = journeys.filter((r) => r.mins).sort((a, b) => b.mins - a.mins)[0];
    const farthest = journeys.filter((r) => r.km > 0).sort((a, b) => b.km - a.km)[0];

    const recordRow = (label, value, r) => [
      label,
      { v: value, num: true },
      r ? `${esc(r.trip.from ?? '')}${r.trip.to ? ' → ' + esc(r.trip.to) : ''}` : '—',
      r ? esc(r.trip.date) : '',
    ];
    const records = [];
    if (earliest) records.push(recordRow('Vroegste check-in', esc(earliest.trip.checkIn), earliest));
    if (latest)   records.push(recordRow('Laatste check-in', esc(latest.trip.checkIn), latest));
    if (longest)  records.push(recordRow('Langste rit', fmtDur(longest.mins), longest));
    if (farthest) records.push(recordRow('Verste rit', fmtKm(farthest.km), farthest));

    el.innerHTML = head +
      section('Check-ins per uur en weekdag', punchcard(recs)) +
      section('Records', table(['', { v: 'Waarde', num: true }, 'Rit', 'Datum'], records)) +
      section('Drukste trajecten',
        table(['Traject', { v: 'Ritten', num: true }],
          topPairs.slice(0, 5).map(([k, g]) => [esc(k), { v: g.length, num: true }]))) +
      section('Meest bezochte stations & haltes',
        table(['Station / halte', { v: 'Bezoeken', num: true }],
          topStops.slice(0, 10).map(([k, n]) => [esc(k), { v: n, num: true }])));
  }

  // ─── Tab 4: Treinen (IC vs. Sprinter behaviour) ─────────────────────────────
  // Built from the GTFS departure that findGtfsMatch identified per NS trip:
  // the likely train (time + type + direction) you were on.

  function _typeClass(t) {
    const s = (t || '').toLowerCase();
    if (s.includes('intercity')) return 'Intercity';
    if (s.includes('sprinter') || s.includes('stoptrein')) return 'Sprinter';
    return 'Overig';
  }

  // Minutes between check-in and the matched departure. The match window is
  // −2…+20 min, but both clocks can sit on either side of midnight.
  function _dwellMins(r) {
    let d = OVMatch.timeToMins(r.gtfsDep.dep) - OVMatch.timeToMins(r.trip.checkIn);
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
  }

  function _avg(list) {
    return list.length ? list.reduce((s, x) => s + x, 0) / list.length : null;
  }

  function renderTrains(recs) {
    const el = document.getElementById('stats-trains');
    if (!el) return;

    const matched = recs.filter((r) => r.gtfsDep && r.trip.checkIn);
    if (!matched.length) {
      el.innerHTML = '<p class="stats-note">Geen herkende treinritten in deze periode. ' +
        'Hiervoor zijn NS-ritten met incheck-tijd nodig én GTFS-vertrektijden (schedules.json).</p>';
      return;
    }

    const trainTrips = recs.filter((r) => isJourney(r) && r.mode === 'TRAIN');
    const byType = groupBy(matched, (r) => _typeClass(r.gtfsDep.type));
    const ic  = byType.get('Intercity') ?? [];
    const spr = byType.get('Sprinter') ?? [];
    const icSpr = ic.length + spr.length;

    const dwells = matched.map(_dwellMins);
    const avgDwell = _avg(dwells);
    const persona = avgDwell <= 3 ? 'Perronsprinter'
      : avgDwell <= 7 ? 'Strak gepland'
      : 'Ruim op tijd';
    const personaSub = avgDwell <= 3 ? 'inchecken en meteen instappen'
      : avgDwell <= 7 ? 'weinig marge, zelden wachten'
      : 'liever even wachten dan rennen';

    const head = cards([
      {
        value: icSpr ? `${Math.round((ic.length / icSpr) * 100)}% IC` : '—',
        label: 'Intercity vs. Sprinter',
        sub: `${ic.length} Intercity · ${spr.length} Sprinter`,
      },
      {
        value: `${avgDwell.toFixed(1)} min`,
        label: 'Inchecken vóór vertrek',
        sub: 'gemiddeld, van check-in tot vertrek van de trein',
      },
      { value: persona, label: 'Reisstijl', sub: personaSub },
      {
        value: matched.length,
        label: 'Herkende treinritten',
        sub: `van ${trainTrips.length} treinritten`,
      },
    ]);

    // Per type: share + how early you check in for it
    const typeRows = [...byType.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([type, g]) => [
        type,
        { v: g.length, num: true },
        { v: `${Math.round((g.length / matched.length) * 100)}%`, num: true },
        { v: `${_avg(g.map(_dwellMins)).toFixed(1)} min`, num: true },
      ]);

    // Dwell histogram
    const buckets = [
      ['al vertrokken?', (d) => d < 0],
      ['0–1 min',  (d) => d >= 0 && d <= 1],
      ['2–3 min',  (d) => d >= 2 && d <= 3],
      ['4–5 min',  (d) => d >= 4 && d <= 5],
      ['6–8 min',  (d) => d >= 6 && d <= 8],
      ['9–12 min', (d) => d >= 9 && d <= 12],
      ['13+ min',  (d) => d >= 13],
    ];
    const dwellBars = barChart(
      buckets
        .map(([label, fn]) => ({ label, value: dwells.filter(fn).length }))
        .filter((b) => b.value > 0),
      (v) => `${v} ritten`);

    // Per departure station
    const stationRows = [...groupBy(matched, (r) => r.trip.from).entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 12)
      .map(([station, g]) => {
        const gIc = g.filter((r) => _typeClass(r.gtfsDep.type) === 'Intercity').length;
        return [
          esc(station),
          { v: g.length, num: true },
          { v: `${Math.round((gIc / g.length) * 100)}%`, num: true },
          { v: `${_avg(g.map(_dwellMins)).toFixed(1)} min`, num: true },
        ];
      });

    // Your recurring trains: same departure time + type + direction
    const regulars = [...groupBy(matched,
      (r) => `${r.gtfsDep.dep}|${r.gtfsDep.type}|${r.gtfsDep.headsign ?? ''}`).entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5)
      .map(([, g]) => [
        { v: esc(g[0].gtfsDep.dep), num: true },
        esc(g[0].gtfsDep.type),
        esc(g[0].gtfsDep.headsign ?? '—'),
        { v: g.length, num: true },
      ]);

    el.innerHTML = head +
      section('Per treintype',
        table(['Type', { v: 'Ritten', num: true }, { v: 'Aandeel', num: true }, { v: 'Gem. vóór vertrek', num: true }], typeRows)) +
      section('Hoe vroeg check je in?', dwellBars,
        'Minuten tussen inchecken en het vertrek van de herkende trein.') +
      section('Per station',
        table(['Station', { v: 'Ritten', num: true }, { v: 'IC-aandeel', num: true }, { v: 'Gem. vóór vertrek', num: true }], stationRows)) +
      section('Jouw vaste treinen',
        table([{ v: 'Vertrek', num: true }, 'Type', 'Richting', { v: 'Ritten', num: true }], regulars),
        'Zelfde vertrektijd, type en richting — de treinen die je steeds opnieuw neemt.');
  }

  // ─── Entry point ────────────────────────────────────────────────────────────

  function renderAll(records, opts = {}) {
    const recs = enrich(records);
    renderTotals(recs, opts.getPool);
    renderCosts(recs);
    renderHabits(recs);
    renderTrains(recs);
  }

  const api = { renderAll, computeCoverage };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OVStats = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
