// ─── Route matching (shared logic) ────────────────────────────────────────────
// Pure matching pipeline used by both the dashboard (browser global) and the
// Node test harness (scripts/test_route_matching.js). No DOM / Leaflet here.
//
// Data is injected once via setMatchData({ stations, routes, schedules }).

(function (root) {
  'use strict';

  let STATIONS = {};
  let ROUTES = null;
  let SCHEDULES = null;

  function setMatchData({ stations, routes, schedules }) {
    if (stations) STATIONS = stations;
    if (routes !== undefined) {
      ROUTES = routes;
      // Annotate each route with its group's operator + mode so a match can
      // report which operator's line was actually used.
      for (const key of Object.keys(ROUTES || {})) {
        const [operator, mode] = key.split(':');
        for (const r of ROUTES[key]) { r.operator = operator; r.mode = mode; }
      }
    }
    if (schedules !== undefined) SCHEDULES = schedules;
  }

  // ─── Small helpers ──────────────────────────────────────────────────────────

  function timeToMins(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function parseOVDate(str) {
    if (!str) return null;
    const parts = str.split('-');
    if (parts.length !== 3) return null;
    if (parts[0].length === 4) return new Date(str);
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  }

  // ─── Station lookup ─────────────────────────────────────────────────────────

  function normStopKey(name) {
    return name.toLowerCase().trim()
      .replace(/\s*\[[^\]]*\]/g, '')   // platform suffixes: "[ B ]", "[A]"
      .replace(/\s*\([^)]*\)/g, '')    // "(Perron A3)", "(2nd class)"
      .replace(/['']/g, '')            // "'s-Hertogenbosch" → "s-hertogenbosch"
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Common abbreviations in OV-chipkaart stop names vs. full words in GTFS
  // ("Burg. Daleslaan" → "Burgemeester Daleslaan").
  const ABBREV = {
    'burg.': 'burgemeester', 'kon.': 'koningin', 'st.': 'sint',
    'gen.': 'generaal', 'past.': 'pastoor', 'prof.': 'professor',
  };

  function expandAbbrev(key) {
    return key.replace(/\b([a-z]+\.)(?=\s|$)/g, (m) => ABBREV[m] ?? m);
  }

  function _keyVariants(name) {
    const key = normStopKey(name);
    const variants = [key, expandAbbrev(key)];
    variants.push(key.replace(/\s*centraal\s*$/, '').trim());
    variants.push(key + ' centraal'); // "Eindhoven" → "eindhoven centraal"
    variants.push(key + ' cs');       // "Utrecht" → "utrecht cs"
    // Platform/halte letter at the end ("Station Ede-Wageningen I"). Tried last
    // so real names ending in a letter ("Strijp S") are never mangled.
    variants.push(key.replace(/\s+[a-z]$|\s+i{1,3}$/, '').trim());
    return [...new Set(variants.filter(Boolean))];
  }

  function lookupStation(name) {
    if (!name) return null;
    for (const v of _keyVariants(name)) {
      if (STATIONS[v]) return STATIONS[v];
    }
    return null;
  }

  // All plausible stations for a (possibly city-less) stop name: direct variant
  // hits plus every "city, name" entry. "Zuidplein" alone matches both the
  // direct key (if any) and "rotterdam, zuidplein".
  function stationCandidates(name) {
    if (!name) return [];
    const out = [];
    const variants = _keyVariants(name);
    for (const v of variants) {
      if (STATIONS[v]) out.push(STATIONS[v]);
    }
    const suffixes = variants.slice(0, 2).map(v => ', ' + v);
    for (const k of Object.keys(STATIONS)) {
      if (suffixes.some(s => k.endsWith(s))) out.push(STATIONS[k]);
    }
    return [...new Set(out)];
  }

  // Resolve both endpoints of a journey together. When a name is ambiguous
  // ("Stadhuis" exists in half the cities of the country) the candidate pair
  // with the smallest mutual distance wins — the two ends of one vehicle ride
  // are always near each other compared to same-named stops elsewhere.
  function resolveJourneyStops(trip) {
    const direct = { from: lookupStation(trip.from), to: lookupStation(trip.to) };
    if (direct.from && direct.to) {
      const fc = stationCandidates(trip.from);
      const tc = stationCandidates(trip.to);
      if (fc.length <= 1 && tc.length <= 1) return direct;
      return _nearestPair(fc.length ? fc : [direct.from], tc.length ? tc : [direct.to]);
    }
    const fc = direct.from ? [direct.from] : stationCandidates(trip.from);
    const tc = direct.to   ? [direct.to]   : stationCandidates(trip.to);
    if (!fc.length || !tc.length) {
      return { from: fc[0] ?? null, to: tc[0] ?? null };
    }
    return _nearestPair(fc, tc);
  }

  function _nearestPair(fromCands, toCands) {
    let best = Infinity, bf = fromCands[0], bt = toCands[0];
    for (const f of fromCands) {
      for (const t of toCands) {
        const d = _dSq([f.lat, f.lon], [t.lat, t.lon]);
        if (d < best) { best = d; bf = f; bt = t; }
      }
    }
    return { from: bf, to: bt };
  }

  // ─── Operator inference ─────────────────────────────────────────────────────

  // Operator from product/txType text only. Stop names are deliberately NOT
  // searched: substring hits inside words produced junk ("Bornsesteeg" → NS,
  // "Arboretumlaan" → RET). Word boundaries guard the short brand names.
  function inferOperator(product, txType, from, to) {
    const p = `${product} ${txType}`.toLowerCase();
    if (/\bns\b|intercity|sprinter|\btrein\b|dal vrij|dal voordeel|volledig vrij|altijd voordeel/.test(p)) return 'NS';
    if (/\bgvb\b/.test(p))        return 'GVB';
    if (/\bret\b/.test(p))        return 'RET';
    if (/\bhtm\b/.test(p))        return 'HTM';
    if (/\bconnexxion\b/.test(p)) return 'Connexxion';
    if (/\barriva\b/.test(p))     return 'Arriva';
    if (/\bqbuzz\b/.test(p))      return 'Qbuzz';
    // "Bus Tram Metro" products name all three modes — stop-name shape is the
    // better signal there (handled by detectModes); only an unambiguous single
    // mode word is meaningful here.
    const modes = ['bus', 'tram', 'metro'].filter(m => new RegExp(`\\b${m}\\b`).test(p));
    if (modes.length === 1) return modes[0][0].toUpperCase() + modes[0].slice(1);
    return 'OV';
  }

  // Transport modes a trip could be, best guess first.
  //
  // The strongest signal is the stop-name shape: bus/tram/metro stops are
  // written "City, Stop name" in the OV-chipkaart CSV while train stations are
  // bare names ("Eindhoven Centraal"). Product text is only trusted when it
  // names a single mode ("Reizen op Rekening Trein"); "Reizen op Rekening Bus
  // Tram Metro" names three and decides nothing.
  function detectModes(trip) {
    const p = (trip.product || '').toLowerCase();
    const btmStops = (trip.from || '').includes(',') && (trip.to || '').includes(',');
    if (btmStops) return ['BUS', 'TRAM', 'METRO'];
    if (/intercity|sprinter|\btrein\b|\btrain\b/.test(p)) return ['TRAIN'];
    const single = ['tram', 'metro', 'bus'].filter(m => new RegExp(`\\b${m}\\b`).test(p));
    if (single.length === 1) return [single[0].toUpperCase()];
    return ['TRAIN']; // bare station names default to train
  }

  // ─── Journey merging ────────────────────────────────────────────────────────
  // The OV-chipkaart CSV emits two rows per journey: a Check-in row (departure
  // stop + check-in time, no destination) and a Check-out row (departure +
  // destination + check-out time, but NO check-in time). Folding the check-in
  // time into its journey row enables GTFS departure matching.

  function _prevOVDate(dateStr) {
    const d = parseOVDate(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() - 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  }

  function mergeJourneys(rows) {
    const out = [];
    const pending = new Map(); // "card|stop|date" → [check-in rows]
    const keyOf = (r, date) => `${r.card}|${normStopKey(r.from)}|${date}`;

    for (const r of rows) {
      const isCheckIn = r.from && !r.to && /check.?in/i.test(r.txType || '');
      if (isCheckIn) {
        const k = keyOf(r, r.date);
        if (!pending.has(k)) pending.set(k, []);
        pending.get(k).push(r);
        continue;
      }
      if (r.from && r.to && !r.checkIn) {
        let ci = null;
        for (const d of [r.date, _prevOVDate(r.date)]) {
          const list = d && pending.get(keyOf(r, d));
          if (list && list.length) { ci = list.pop(); break; }
        }
        out.push(ci ? { ...r, checkIn: ci.checkIn } : r);
        continue;
      }
      out.push(r);
    }

    // Check-ins that never met a check-out (forgotten check-out / still
    // travelling) are kept as-is; they have no destination to draw.
    for (const list of pending.values()) out.push(...list);
    return out;
  }

  // Re-derive the inferred fields on a stored trip. Cached trips may carry an
  // operator produced by an older, buggier inference — always recompute.
  function refreshTripInference(trip) {
    trip.operator = inferOperator(trip.product, trip.txType, trip.from, trip.to);
    return trip;
  }

  // ─── publicCode extraction ──────────────────────────────────────────────────

  function extractPublicCode(product) {
    const p = (product || '').toLowerCase();
    if (p.includes('intercity')) return 'Intercity';
    if (p.includes('sprinter'))  return 'Sprinter';
    const byLabel = p.match(/(?:lijn\s*|line\s*|nr\.?\s*)([a-z0-9]+)/i);
    if (byLabel) return byLabel[1];
    const num = p.match(/\b(\d+[a-z]?)\b/);
    if (num) return num[1];
    return null;
  }

  // ─── Route pool selection ───────────────────────────────────────────────────

  // All routes of the given modes, across every operator. Operator inference
  // from the CSV is too unreliable to narrow the pool with (most products are
  // subscriptions valid on any operator); the ~5 km proximity threshold plus
  // publicCode narrowing do the disambiguation instead.
  function getRoutePool(modes) {
    if (!ROUTES) return [];
    return Object.keys(ROUTES)
      .filter(k => modes.includes(k.split(':')[1]))
      .flatMap(k => ROUTES[k]);
  }

  // ─── Proximity scoring ──────────────────────────────────────────────────────

  // Squared distance in degree-space, longitude adjusted for NL (cos 51° ≈ 0.629).
  function _dSq(a, b) {
    const dlat = a[0] - b[0];
    const dlon = (a[1] - b[1]) * 0.629;
    return dlat * dlat + dlon * dlon;
  }

  // Closest point on the polyline to `coord`, measured against the line
  // segments (not just the vertices — simplified polylines have segments of a
  // kilometre or more, so vertex distance overestimates badly).
  // Returns the segment start index, the parameter along it, the projected
  // point and the squared distance.
  function _closestOnLine(coords, coord) {
    const py = coord.lat, px = coord.lon * 0.629;
    let best = { idx: 0, t: 0, dSq: Infinity, proj: coords[0] };
    for (let i = 0; i < coords.length - 1; i++) {
      const ay = coords[i][0],     ax = coords[i][1] * 0.629;
      const by = coords[i + 1][0], bx = coords[i + 1][1] * 0.629;
      const dx = bx - ax, dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx, qy = ay + t * dy;
      const ddx = px - qx, ddy = py - qy;
      const dSq = ddx * ddx + ddy * ddy;
      if (dSq < best.dSq) {
        best = { idx: i, t, dSq, proj: [qy, qx / 0.629] };
      }
    }
    return best;
  }

  // Clip a polyline between two projected points, ordered from → to.
  function _clipLine(coords, f, t) {
    const fwd = f.idx < t.idx || (f.idx === t.idx && f.t <= t.t);
    const [a, b] = fwd ? [f, t] : [t, f];
    const pts = [a.proj, ...coords.slice(a.idx + 1, b.idx + 1), b.proj];
    return fwd ? pts : pts.reverse();
  }

  // ~5 km threshold in degree-squared units
  const MAX_DSQ = 0.002;

  // Score every route in `pool` against the two endpoints; returns the best
  // {route, f, t, score} or null.
  function _bestInPool(pool, fromCoord, toCoord) {
    let best = null;
    for (const route of pool) {
      const c = route.coords;
      const f = _closestOnLine(c, fromCoord);
      if (f.dSq > MAX_DSQ) continue;
      const t = _closestOnLine(c, toCoord);
      if (t.dSq > MAX_DSQ) continue;
      if (f.idx === t.idx && f.t === t.t) continue; // both map to one point
      const score = f.dSq + t.dSq;
      if (!best || score < best.score) best = { route, f, t, score };
    }
    return best;
  }

  function findRouteGeometry(trip, fromCoord, toCoord, dbg) {
    const modes = detectModes(trip);
    let pool = getRoutePool(modes);
    if (dbg) dbg.poolSize = pool.length;

    const pc = extractPublicCode(trip.product);
    if (dbg) dbg.publicCode = pc;
    if (pc) {
      const narrowed = pool.filter(r => r.publicCode === pc);
      if (narrowed.length) pool = narrowed;
    }
    if (dbg) dbg.narrowedSize = pool.length;

    let best = _bestInPool(pool, fromCoord, toCoord);

    // A correct match has both stops within a few hundred metres of the line.
    // A merely tolerated one (up to the 5 km gate) usually means the mode
    // guess was wrong — e.g. tram stops written without a city prefix look
    // like train stations and shadow the actual tram line with some far-off
    // intercity track. In that case let every other mode compete on score.
    const GOOD_DSQ = 5e-5; // ≈ 800 m
    const isGood = (m) => m && m.f.dSq <= GOOD_DSQ && m.t.dSq <= GOOD_DSQ;
    if (!isGood(best)) {
      const otherModes = ['TRAIN', 'BUS', 'TRAM', 'METRO'].filter(m => !modes.includes(m));
      const alt = _bestInPool(getRoutePool(otherModes), fromCoord, toCoord);
      if (alt && (!best || alt.score < best.score)) best = alt;
    }

    if (dbg) {
      dbg.matchedRoute    = best ? best.route.name : null;
      dbg.matchedOperator = best ? best.route.operator : null;
      dbg.matchedMode     = best ? best.route.mode : null;
      dbg.score   = best ? best.score : null;
      dbg.fromIdx = best ? best.f.idx : null;
      dbg.toIdx   = best ? best.t.idx : null;
      dbg.routePts = best ? best.route.coords.length : null;
    }

    // Journeys with a transfer (check-in Eindhoven, check-out Nijmegen) are
    // covered by no single line geometry; route them over the rail network.
    // The rail path also competes with a poor single-line match.
    if (!isGood(best) && modes.includes('TRAIN')) {
      const rail = _railPathDetailed(fromCoord, toCoord);
      if (rail && (!best || rail.fDSq + rail.tDSq < best.score)) {
        if (dbg) {
          dbg.matchedRoute = 'spoornetwerk (overstap)';
          dbg.matchedMode  = 'TRAIN';
          dbg.routePts     = rail.coords.length;
        }
        return rail.coords;
      }
    }

    if (best) return _clipLine(best.route.coords, best.f, best.t);
    return null;
  }

  // ─── Rail network graph (transfer journeys) ─────────────────────────────────
  // All TRAIN geometries merged into one graph: points within ~60 m snap to a
  // shared node, consecutive route points become edges. Dijkstra (with a
  // straight-line A* heuristic) then finds the track path between any two
  // stations, transfers included. Built lazily on first use.

  let _railGraph = null;

  function _railKey(lat, lon) {
    return Math.round(lat / 6e-4) * 100000 + Math.round(lon / 9e-4);
  }

  function _buildRailGraph() {
    const nodes = new Map(); // key → { lat, lon, adj: Map(key → dist) }
    const getNode = (lat, lon) => {
      const k = _railKey(lat, lon);
      let n = nodes.get(k);
      if (!n) { n = { lat, lon, adj: new Map() }; nodes.set(k, n); }
      return [k, n];
    };
    for (const route of getRoutePool(['TRAIN'])) {
      const c = route.coords;
      if (c.length < 2) continue;
      let [pk, pn] = getNode(c[0][0], c[0][1]);
      for (let i = 1; i < c.length; i++) {
        const [k, n] = getNode(c[i][0], c[i][1]);
        if (k !== pk) {
          const d = Math.sqrt(_dSq([pn.lat, pn.lon], [n.lat, n.lon]));
          const prev = pn.adj.get(k);
          if (prev === undefined || d < prev) { pn.adj.set(k, d); n.adj.set(pk, d); }
        }
        pk = k; pn = n;
      }
    }
    return nodes;
  }

  function _nearestRailNode(coord) {
    let bestK = null, bestD = Infinity;
    for (const [k, n] of _railGraph) {
      const d = _dSq([n.lat, n.lon], [coord.lat, coord.lon]);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return bestD <= MAX_DSQ ? { key: bestK, dSq: bestD } : null;
  }

  function findRailPath(fromCoord, toCoord) {
    return _railPathDetailed(fromCoord, toCoord)?.coords ?? null;
  }

  function _railPathDetailed(fromCoord, toCoord) {
    if (!ROUTES) return null;
    if (!_railGraph) _railGraph = _buildRailGraph();

    const start = _nearestRailNode(fromCoord);
    const goal2 = _nearestRailNode(toCoord);
    if (!start || !goal2 || start.key === goal2.key) return null;
    const startK = start.key, goalK = goal2.key;

    const goal = _railGraph.get(goalK);
    const heur = (n) => Math.sqrt(_dSq([n.lat, n.lon], [goal.lat, goal.lon]));

    // A* over the node graph
    const dist = new Map([[startK, 0]]);
    const prev = new Map();
    const open = [[heur(_railGraph.get(startK)), startK]]; // binary min-heap
    const closed = new Set();

    const push = (item) => {
      open.push(item);
      let i = open.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (open[p][0] <= open[i][0]) break;
        [open[p], open[i]] = [open[i], open[p]]; i = p;
      }
    };
    const pop = () => {
      const top = open[0], last = open.pop();
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let s = i;
          if (l < open.length && open[l][0] < open[s][0]) s = l;
          if (r < open.length && open[r][0] < open[s][0]) s = r;
          if (s === i) break;
          [open[s], open[i]] = [open[i], open[s]]; i = s;
        }
      }
      return top;
    };

    while (open.length) {
      const [, k] = pop();
      if (k === goalK) break;
      if (closed.has(k)) continue;
      closed.add(k);
      const n = _railGraph.get(k);
      const dk = dist.get(k);
      for (const [mk, w] of n.adj) {
        if (closed.has(mk)) continue;
        const nd = dk + w;
        if (nd < (dist.get(mk) ?? Infinity)) {
          dist.set(mk, nd);
          prev.set(mk, k);
          push([nd + heur(_railGraph.get(mk)), mk]);
        }
      }
    }

    if (!dist.has(goalK)) return null;
    const path = [];
    for (let k = goalK; k !== undefined; k = prev.get(k)) {
      const n = _railGraph.get(k);
      path.push([n.lat, n.lon]);
      if (k === startK) break;
    }
    return { coords: path.reverse(), fDSq: start.dSq, tDSq: goal2.dSq };
  }

  // ─── GTFS schedule matching ─────────────────────────────────────────────────

  const PC_TO_GTFS_TYPES = {
    Intercity: ['INTERCITY'],
    Sprinter:  ['SPRINTER'],
  };
  const ALL_NS_TYPES = [...PC_TO_GTFS_TYPES.Intercity, ...PC_TO_GTFS_TYPES.Sprinter];

  function findLikelyDeparture(trip) {
    if (!SCHEDULES || !trip.checkIn || !trip.from || !trip.date) return null;

    const pc = extractPublicCode(trip.product);
    let validTypes = PC_TO_GTFS_TYPES[pc];
    if (!validTypes && (trip.operator === 'NS' || trip.operator === 'OV')) {
      validTypes = ALL_NS_TYPES;
    }
    if (!validTypes) return null;

    const station = lookupStation(trip.from);
    let stopDeps = SCHEDULES.departures[trip.from];
    if (!stopDeps && station?.name) stopDeps = SCHEDULES.departures[station.name];
    if (!stopDeps) return null;

    const tripDate = parseOVDate(trip.date);
    if (!tripDate) return null;
    const jsDay   = tripDate.getDay();               // 0=Sun
    const wdayBit = jsDay === 0 ? 6 : jsDay - 1;    // remap: Mon=0, Sun=6
    const wdayMask = 1 << wdayBit;

    const checkInMins = timeToMins(trip.checkIn);

    // You check in shortly BEFORE the train leaves: accept departures from 2
    // minutes before check-in (clock skew) to 20 minutes after, and prefer the
    // first departure at/after check-in.
    const candidates = stopDeps.filter((d) => {
      const t = d.type.toUpperCase();
      if (!validTypes.some((vt) => t === vt || t.startsWith(vt))) return false;
      const delta = timeToMins(d.dep) - checkInMins;
      if (delta < -2 || delta > 20) return false;
      return ((SCHEDULES.patterns[d.pid] ?? 0) & wdayMask) !== 0;
    });

    if (!candidates.length) return null;
    const rank = (d) => {
      const delta = timeToMins(d.dep) - checkInMins;
      return delta >= 0 ? delta : 100 - delta; // waiting beats already-departed
    };
    return candidates.sort((a, b) => rank(a) - rank(b));
  }

  // Best GTFS departure + clipped shape for a journey. Departures are tried in
  // rank order until one's shape actually passes both endpoints — this is what
  // tells the 14:21 train TOWARDS Nijmegen from the 14:21 train away from it.
  // A departure without covering shape (transfer journey: the first leg's
  // shape ends at the transfer station) is still returned for the popup text,
  // with coords = null so the caller falls back to other geometry sources.
  function findGtfsMatch(trip, fromCoord, toCoord) {
    const candidates = findLikelyDeparture(trip);
    if (!candidates || !candidates.length) return null;

    // GTFS shapes run in travel order, so the departure stop must project
    // EARLIER on the shape than the destination — that separates the 17:51
    // towards the destination from the 17:51 going the other way.
    let nonDirectional = null;
    for (const dep of candidates) {
      const shape = SCHEDULES.shapes?.[dep.shape];
      if (!shape || shape.length < 2) continue;
      const f = _closestOnLine(shape, fromCoord);
      if (f.dSq > MAX_DSQ) continue;
      const t = _closestOnLine(shape, toCoord);
      if (t.dSq > MAX_DSQ) continue;
      if (f.idx === t.idx && f.t === t.t) continue;
      if (f.idx < t.idx || (f.idx === t.idx && f.t < t.t)) {
        return { dep, coords: _clipLine(shape, f, t) };
      }
      nonDirectional ??= { dep, coords: _clipLine(shape, f, t) };
    }
    if (nonDirectional) return nonDirectional;

    // Transfer journey: no candidate's shape reaches the destination. The
    // likeliest first leg travels TOWARDS it: the projection of the departure
    // stop must come before the shape's closest approach to the destination,
    // and of those trains the one getting closest wins.
    let best = null;
    for (const dep of candidates) {
      const shape = SCHEDULES.shapes?.[dep.shape];
      if (!shape || shape.length < 2) continue;
      const f = _closestOnLine(shape, fromCoord);
      if (f.dSq > MAX_DSQ) continue;
      const t = _closestOnLine(shape, toCoord);
      const towards = f.idx < t.idx || (f.idx === t.idx && f.t < t.t);
      const rank = (towards ? 0 : 1e6) + t.dSq;
      if (!best || rank < best.rank) best = { dep, rank };
    }
    return { dep: (best ?? { dep: candidates[0] }).dep, coords: null };
  }

  function findGtfsGeometry(dep, fromCoord, toCoord) {
    if (!dep?.shape || !SCHEDULES?.shapes) return null;
    const coords = SCHEDULES.shapes[dep.shape];
    if (!coords || coords.length < 2) return null;

    const f = _closestOnLine(coords, fromCoord);
    const t = _closestOnLine(coords, toCoord);
    if (f.dSq > MAX_DSQ || t.dSq > MAX_DSQ) return null;
    if (f.idx === t.idx && f.t === t.t) return null;

    return _clipLine(coords, f, t);
  }

  // ─── Exports ────────────────────────────────────────────────────────────────

  const api = {
    setMatchData,
    timeToMins,
    parseOVDate,
    lookupStation,
    resolveJourneyStops,
    mergeJourneys,
    refreshTripInference,
    inferOperator,
    detectModes,
    extractPublicCode,
    getRoutePool,
    findRouteGeometry,
    findRailPath,
    findLikelyDeparture,
    findGtfsMatch,
    findGtfsGeometry,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.OVMatch = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
