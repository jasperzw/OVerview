#!/usr/bin/env python3
"""
Build routes.json from the OpenOV lijnnetkaart shapefile (20260511.zip).

Usage:
    python scripts/build_route_geometries.py [path/to/20260511.zip]

Output:
    web_extension/data/routes.json

The shapefile contains polyline geometries for all Dutch OV lines.
We filter to TRAIN/TRAM/METRO (755 routes), simplify geometry, and
output a compact JSON keyed by "OPERATOR:MODE" for fast lookup.
"""

import json
import math
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path


# ── Douglas-Peucker simplification ────────────────────────────────────────────

def _pt_seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, ((px - ax)*dx + (py - ay)*dy) / (dx*dx + dy*dy)))
    return math.hypot(px - ax - t*dx, py - ay - t*dy)

def _dp(points, eps):
    if len(points) <= 2:
        return points
    dists = [_pt_seg_dist(points[i], points[0], points[-1]) for i in range(1, len(points)-1)]
    max_d = max(dists)
    if max_d <= eps:
        return [points[0], points[-1]]
    idx = dists.index(max_d) + 1
    return _dp(points[:idx+1], eps)[:-1] + _dp(points[idx:], eps)


# ── Shapefile reading ──────────────────────────────────────────────────────────

def read_shapefile(zip_path):
    """Yield (record_dict, [(lon, lat), ...]) for each shape in the zip."""
    import shapefile

    with zipfile.ZipFile(zip_path) as zf:
        shp_names = [n for n in zf.namelist() if n.lower().endswith('.shp')]
        if not shp_names:
            raise ValueError(f"No .shp file in {zip_path}")
        base = shp_names[0][:-4]

        with tempfile.TemporaryDirectory() as tmp:
            for ext in ('.shp', '.dbf', '.shx', '.prj'):
                fname = base + ext
                if fname in zf.namelist():
                    zf.extract(fname, tmp)

            sf = shapefile.Reader(os.path.join(tmp, base + '.shp'))
            fields = [f[0] for f in sf.fields[1:]]
            for sr in sf.iterShapeRecords():
                rec = dict(zip(fields, sr.record))
                yield rec, sr.shape.points


# ── Station name extraction ────────────────────────────────────────────────────

_SERVICE_SUFFIX = re.compile(r'\s+[A-Z]{1,4}\d+\S*\s*$')

def parse_name(name):
    """Parse 'StationA <-> StationB [IC2100]' → (from, to)."""
    if ' <-> ' not in name:
        return '', ''
    parts = name.split(' <-> ', 1)
    frm = parts[0].strip()
    to  = _SERVICE_SUFFIX.sub('', parts[1]).strip()
    return frm, to


# ── Main ───────────────────────────────────────────────────────────────────────

MODES = {'TRAIN', 'TRAM', 'METRO', 'BUS'}
# ~30 m tolerance in degrees at NL latitude
EPSILON = 0.00027
# Bus polylines follow every road bend; a coarser tolerance (~50 m) keeps the
# output small while staying well inside the proximity-matching threshold.
EPSILON_BUS = 0.00045

# Foreign operators whose lines only clutter the (NL-focused) bus pool
SKIP_OPERATORS = {'De Lijn', 'NIAG Intern', 'Deutsche Bahn Intern'}

# Normalise shapefile brand names → OV-chipkaart pto codes
OPERATOR_NORM = {
    'Blauwnet Arriva':  'Arriva',
    'Blauwnet Keolis':  'Keolis',
    'R-net NS':         'NS',
    'R-net Qbuzz':      'Qbuzz',
    'RRReis Arriva':    'Arriva',
    'RRReis Keolis':    'Keolis',
    'NS International': 'NS',
}

def main():
    project_root = Path(__file__).resolve().parent.parent

    zip_path = Path(sys.argv[1]) if len(sys.argv) > 1 else project_root / '20260511.zip'
    out_path = project_root / 'web_extension' / 'data' / 'routes.json'

    if not zip_path.exists():
        print(f"ERROR: shapefile not found at {zip_path}", file=sys.stderr)
        print("Download 20260511.zip from http://data.openov.nl/lijnnetkaart/ "
              "and place it in the project root.", file=sys.stderr)
        sys.exit(1)

    print(f"Reading {zip_path} …")

    routes = {}          # key → list of route dicts
    total = skipped = 0

    for rec, points in read_shapefile(zip_path):
        total += 1
        mode = (rec.get('TRANSPORTM') or '').strip().upper()
        if mode not in MODES:
            skipped += 1
            continue

        operator    = (rec.get('OPERATOR')   or '').strip()
        if operator in SKIP_OPERATORS:
            skipped += 1
            continue
        operator    = OPERATOR_NORM.get(operator, operator)
        public_code = (rec.get('PUBLICCODE') or '').strip()
        name        = (rec.get('NAME')       or '').strip()

        if not operator:
            skipped += 1
            continue

        # Simplify and convert (lon,lat) → [lat,lon] for Leaflet
        simplified = _dp(list(points), EPSILON_BUS if mode == 'BUS' else EPSILON)
        coords = [[round(lat, 5), round(lon, 5)] for lon, lat in simplified]

        if len(coords) < 2:
            skipped += 1
            continue

        frm, to = parse_name(name)

        key = f"{operator}:{mode}"
        routes.setdefault(key, []).append({
            'publicCode': public_code,
            'name':       name,
            'from':       frm,
            'to':         to,
            'coords':     coords,
        })

    n_routes = sum(len(v) for v in routes.values())
    n_points = sum(len(r['coords']) for v in routes.values() for r in v)
    print(f"Processed {total} shapes → {n_routes} routes kept "
          f"({skipped} skipped, {n_points} total points after simplification)")
    print(f"Operator:mode groups: {sorted(routes)}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(routes, f, separators=(',', ':'), ensure_ascii=False)

    size_kb = out_path.stat().st_size / 1024
    print(f"Written to {out_path} ({size_kb:.0f} KB)")


if __name__ == '__main__':
    main()
