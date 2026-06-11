#!/usr/bin/env python3
"""
Build web_extension/data/schedules.json from GTFS-NL (NS trains only).

Usage:
    python scripts/build_trip_schedules.py /path/to/gtfs-nl.zip

Download the zip from https://gtfs.ovapi.nl/nl/gtfs-nl.zip (~206 MB).
Re-run whenever you want to refresh the timetable data.

Output: web_extension/data/schedules.json
  {
    "route_types": ["Intercity", "Sprinter", ...],
    "patterns": {"p0": 31, ...},   // 7-bit weekday mask, bit 0=Mon
    "departures": {
      "Eindhoven Centraal": [
        {"dep":"08:32","type":"Intercity","headsign":"Amsterdam Centraal",
         "pid":"p0","shape":"shape:1234"},
        ...                        // sorted by dep time
      ]
    },
    "shapes": {
      "shape:1234": [[lat,lon], ...]   // Douglas-Peucker simplified
    }
  }

Patterns use a 7-bit weekday bitmask (bit 0=Monday … bit 6=Sunday) rather
than per-date bitfields, because the GTFS feed only covers a small rolling
window.  Weekday patterns are stable year-round: Mon–Fri service = 31,
daily = 127, etc.  NS timetable changes (Jun/Dec) rarely affect which
days a service runs, so this is accurate enough for historical matching.
"""

import os, sys, zipfile, csv, io, json
from datetime import date, timedelta
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────────

GTFS_ZIP = sys.argv[1] if len(sys.argv) > 1 else 'gtfs-nl.zip'
OUTPUT   = 'web_extension/data/schedules.json'
RDP_EPS  = 0.00027   # ~30 m — same tolerance as build_route_geometries.py

# ── Helpers ────────────────────────────────────────────────────────────────────

def read_csv(zf, name):
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))


def norm_time(t):
    """Normalise GTFS time (may be 25:xx for past-midnight) to HH:MM."""
    if not t:
        return None
    parts = t.split(':')
    if len(parts) < 2:
        return None
    return f'{int(parts[0]) % 24:02d}:{parts[1]}'


def dates_to_wdays(date_set):
    """7-bit weekday mask from a set of date objects (bit 0=Mon … bit 6=Sun)."""
    mask = 0
    for d in date_set:
        mask |= 1 << d.weekday()
    return mask


def _pt_seg_dist(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    len2 = dx*dx + dy*dy
    if len2 == 0:
        return ((px-ax)**2 + (py-ay)**2) ** 0.5
    t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy) / len2))
    return ((px - ax - t*dx)**2 + (py - ay - t*dy)**2) ** 0.5


def rdp(pts, eps):
    """Iterative Ramer–Douglas–Peucker simplification."""
    if len(pts) <= 2:
        return list(pts)
    mask = [False] * len(pts)
    mask[0] = mask[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        max_d, max_i = 0.0, lo
        for i in range(lo + 1, hi):
            d = _pt_seg_dist(pts[i], pts[lo], pts[hi])
            if d > max_d:
                max_d, max_i = d, i
        if max_d > eps:
            mask[max_i] = True
            stack.append((lo, max_i))
            stack.append((max_i, hi))
    return [pts[i] for i in range(len(pts)) if mask[i]]

# ── Load GTFS ──────────────────────────────────────────────────────────────────

print(f'Opening {GTFS_ZIP} …')
with zipfile.ZipFile(GTFS_ZIP) as zf:
    names = set(zf.namelist())

    # 1. Identify NS agency_ids
    agencies = read_csv(zf, 'agency.txt')
    ns_agency_ids = {a['agency_id'] for a in agencies
                     if 'NS' in a.get('agency_name', '') or a.get('agency_id', '') == 'NS'}
    print(f'NS agency_ids: {ns_agency_ids}')

    # 2. NS rail routes (route_type 2 = rail)
    ns_route_ids = {}   # route_id → route_short_name
    for r in read_csv(zf, 'routes.txt'):
        if r.get('agency_id') in ns_agency_ids and r.get('route_type') == '2':
            ns_route_ids[r['route_id']] = r.get('route_short_name', '?').strip()
    print(f'NS rail routes: {len(ns_route_ids)}')

    # 3. Trips for NS routes (include shape_id for geometry lookup)
    ns_trips = {}   # trip_id → {service_id, type, headsign, shape_id}
    for t in read_csv(zf, 'trips.txt'):
        if t['route_id'] in ns_route_ids:
            ns_trips[t['trip_id']] = {
                'service_id': t['service_id'],
                'type':       ns_route_ids[t['route_id']],
                'headsign':   t.get('trip_headsign', '').strip(),
                'shape_id':   t.get('shape_id', ''),
            }
    print(f'NS trips total: {len(ns_trips)}')

    # 4. Build service_id → weekday bitmask from calendar + exceptions.
    #    We use the full date range in the feed (not limited to a window) so that
    #    every service gets a non-zero weekday mask.
    service_dates = defaultdict(set)

    if 'calendar.txt' in names:
        DAY_COLS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        for row in read_csv(zf, 'calendar.txt'):
            svc   = row['service_id']
            start = date.fromisoformat(row['start_date'])
            end   = date.fromisoformat(row['end_date'])
            days  = {i for i, col in enumerate(DAY_COLS) if row.get(col) == '1'}
            cur = start
            while cur <= end:
                if cur.weekday() in days:
                    service_dates[svc].add(cur)
                cur += timedelta(days=1)

    if 'calendar_dates.txt' in names:
        for row in read_csv(zf, 'calendar_dates.txt'):
            svc = row['service_id']
            d   = date.fromisoformat(row['date'])
            if row['exception_type'] == '1':
                service_dates[svc].add(d)
            elif row['exception_type'] == '2':
                service_dates[svc].discard(d)

    # Keep only trips with at least one service date
    ns_trips = {tid: v for tid, v in ns_trips.items()
                if service_dates.get(v['service_id'])}
    print(f'NS trips with service dates: {len(ns_trips)}')

    # 5. Deduplicate service patterns by weekday mask
    wdays_to_pid = {}   # wdays_int → pid
    patterns     = {}   # pid → wdays_int
    svc_to_pid   = {}   # service_id → pid (cache)
    _pid_ctr     = [0]

    def get_pid(svc_id):
        if svc_id in svc_to_pid:
            return svc_to_pid[svc_id]
        wdays = dates_to_wdays(service_dates.get(svc_id, set()))
        if wdays not in wdays_to_pid:
            pid = f'p{_pid_ctr[0]}'
            _pid_ctr[0] += 1
            wdays_to_pid[wdays] = pid
            patterns[pid]       = wdays
        pid = wdays_to_pid[wdays]
        svc_to_pid[svc_id] = pid
        return pid

    # 6. Stop id → name
    stop_id_name = {s['stop_id']: s['stop_name'].strip()
                    for s in read_csv(zf, 'stops.txt')}

    # 7. Stream stop_times.txt → build per-stop departure list
    print('Streaming stop_times.txt …')
    departures = defaultdict(list)
    ns_trip_ids = set(ns_trips)
    row_count = 0

    with zf.open('stop_times.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))
        for row in reader:
            row_count += 1
            trip_id = row['trip_id']
            if trip_id not in ns_trip_ids:
                continue
            stop_name = stop_id_name.get(row['stop_id'], '')
            dep = norm_time(row.get('departure_time') or row.get('arrival_time', ''))
            if not stop_name or not dep:
                continue
            info = ns_trips[trip_id]
            departures[stop_name].append({
                'dep':      dep,
                'type':     info['type'],
                'headsign': info['headsign'],
                'pid':      get_pid(info['service_id']),
                'shape':    info['shape_id'],
            })

    print(f'Processed {row_count:,} stop_time rows → {len(departures)} stops')

    # 8. Deduplicate (same dep+type+headsign+pid+shape → keep one)
    total_entries = 0
    for stop_name in departures:
        seen, uniq = set(), []
        for e in departures[stop_name]:
            key = (e['dep'], e['type'], e['headsign'], e['pid'], e['shape'])
            if key not in seen:
                seen.add(key)
                uniq.append(e)
        departures[stop_name] = sorted(uniq, key=lambda x: x['dep'])
        total_entries += len(departures[stop_name])

    print(f'Unique departure entries: {total_entries:,}  across {len(departures)} stops')
    print(f'Service patterns (weekday masks): {len(patterns)}')
    for pid, wdays in sorted(patterns.items()):
        days = ''.join(n for i,n in enumerate('MTWTFSS') if wdays>>i&1)
        print(f'  {pid}: {wdays:07b}  ({days})')

    all_types = sorted({e['type'] for deps in departures.values() for e in deps})
    print(f'Route types in feed: {all_types}')

    # 9. Stream shapes.txt → simplified geometries for NS shapes only
    ns_shape_ids = {info['shape_id'] for info in ns_trips.values() if info['shape_id']}
    shapes_raw = defaultdict(list)

    if 'shapes.txt' in names:
        print(f'Streaming shapes.txt  ({len(ns_shape_ids)} NS shapes needed) …')
        with zf.open('shapes.txt') as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))
            for row in reader:
                sid = row.get('shape_id', '')
                if sid not in ns_shape_ids:
                    continue
                shapes_raw[sid].append((
                    int(row.get('shape_pt_sequence', 0)),
                    float(row['shape_pt_lat']),
                    float(row['shape_pt_lon']),
                ))
        print(f'Loaded {len(shapes_raw)} NS shapes — simplifying …')
    else:
        print('shapes.txt not found in zip — geometry will use lijnnetkaart fallback')

    shapes = {}
    total_pts_before = total_pts_after = 0
    for sid, pts in shapes_raw.items():
        coords = [[lat, lon] for _, lat, lon in sorted(pts)]
        simplified = rdp(coords, RDP_EPS)
        shapes[sid] = simplified
        total_pts_before += len(coords)
        total_pts_after  += len(simplified)

    if shapes:
        ratio = total_pts_after / max(total_pts_before, 1) * 100
        print(f'Shapes: {total_pts_before:,} pts → {total_pts_after:,} pts ({ratio:.0f}%)')

    # 10. Write output
    output = {
        'route_types': all_types,
        'patterns':    patterns,    # {pid: wdays_int}
        'departures':  {k: v for k, v in sorted(departures.items())},
        'shapes':      shapes,
    }

    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

size_mb = os.path.getsize(OUTPUT) / 1_048_576
print(f'\nWrote {OUTPUT}  ({size_mb:.1f} MB)')
print('Run  python scripts/build_trip_schedules.py <zip>  to refresh.')
