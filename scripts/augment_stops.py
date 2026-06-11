#!/usr/bin/env python3
"""
Augment web_extension/data/stops.json with stops from a GTFS-NL feed.

Usage:
    python3 scripts/augment_stops.py [path/to/gtfs-nl.zip]

Existing entries are kept untouched; only stop names whose normalised key is
missing are added. Multiple GTFS quays share one name (one per platform /
direction) — their coordinates are averaged, which is plenty accurate for the
~5 km proximity matching the dashboard does.
"""

import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path


def norm_key(name: str) -> str:
    """Mirror of normStopKey() in web_extension/dashboard/matching.js."""
    key = name.lower().strip()
    key = re.sub(r'\s*\[[^\]]*\]', '', key)
    key = re.sub(r'\s*\([^)]*\)', '', key)
    key = key.replace("'", '').replace('’', '')
    key = re.sub(r'\s+', ' ', key).strip()
    return key


def main():
    project_root = Path(__file__).resolve().parent.parent
    zip_path = Path(sys.argv[1]) if len(sys.argv) > 1 else project_root / 'gtfs-nl.zip'
    stops_path = project_root / 'web_extension' / 'data' / 'stops.json'

    stops = json.loads(stops_path.read_text(encoding='utf-8'))
    print(f'Existing stops: {len(stops)}')

    # name → [sum_lat, sum_lon, count, display_name]
    gtfs: dict[str, list] = {}
    with zipfile.ZipFile(zip_path) as zf, zf.open('stops.txt') as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding='utf-8'))
        for row in reader:
            name = (row['stop_name'] or '').strip()
            if not name:
                continue
            try:
                lat, lon = float(row['stop_lat']), float(row['stop_lon'])
            except ValueError:
                continue
            key = norm_key(name)
            if key in stops:
                continue
            acc = gtfs.setdefault(key, [0.0, 0.0, 0, name])
            acc[0] += lat
            acc[1] += lon
            acc[2] += 1

    for key, (slat, slon, n, name) in gtfs.items():
        stops[key] = {
            'lat': round(slat / n, 6),
            'lon': round(slon / n, 6),
            'name': name,
        }

    print(f'Added {len(gtfs)} stops from GTFS → {len(stops)} total')
    stops_path.write_text(
        json.dumps(stops, separators=(',', ':'), ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'Written {stops_path} ({stops_path.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
