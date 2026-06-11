# Alternative Form Factors for OVerzicht

Now that data comes from a proper JSON API (no web scraping), the tool is no longer
tied to a browser session. That opens up new form factors.

---

## 1. CLI + TUI dashboard (`overzicht` command)

A terminal application you run locally.

### How it works
```
$ overzicht
? OV gebruikersnaam: jan@example.com
? Wachtwoord: ••••••••

✓ 847 reizen opgehaald (2021–2024)

┌──────────────────────────────────────────────────────────────┐
│  OVerzicht — reiskaart 2021-01-01 → 2024-06-08              │
│                                                              │
│  ████████████████████  NS (63%)                             │
│  ████████             GVB (22%)                             │
│  ████                 Connexxion (9%)                       │
│  ██                   Arriva (6%)                           │
│                                                              │
│  Totaal uitgegeven:  € 2.847,30                             │
│  Gem. per maand:     € 71,18                                │
│  Meest gereden:      AMS Centraal → Utrecht CS (142×)       │
└──────────────────────────────────────────────────────────────┘

[m] maandoverzicht  [r] routes  [e] exporteer CSV  [q] afsluiten
```

### Stack
- **Python** with `rich` (tables, progress bars) or `textual` (full TUI with mouse support)
- Tokens cached in `~/.config/overzicht/token.json`
- `overzicht export` sub-command dumps to CSV/JSON/Parquet

### Why it's good
- Zero browser dependency — run it on a server, in a cron job, on a headless machine
- Easy to pipe: `overzicht export | analysis.py`
- `textual` can render a real interactive map in the terminal (block characters)

---

## 2. Static site generator — shareable HTML report

A command you run once that produces a self-contained `overzicht.html` you can open
offline, share with a partner, or host on GitHub Pages.

### How it works
```
$ overzicht-export --output ~/overzicht.html
Fetching 847 trips…
Building map…
Writing overzicht.html (2.1 MB, self-contained)
Done. Open: file:///home/jan/overzicht.html
```

The output file bundles Leaflet, Chart.js, and all trip data as inline JSON — no
server needed, no login required to view.

### Pages in the report
| Tab | Content |
|---|---|
| Kaart | Leaflet/OSM map with all routes, color-coded by operator |
| Tijdlijn | Monthly bar chart of spending |
| Statistieken | Top routes, operators, day-of-week heatmap |
| Tabel | Searchable, sortable list of all trips |

### Why it's good
- The generated file is the archive — you can open it in 10 years
- Easy to share ("here's my travel year in review")
- No extension install friction for people who just want to see the data once
- Could be automated: `cron` weekly, output committed to a private git repo

---

## 3. Home Assistant integration / sensor

A custom integration that pushes OV travel data into Home Assistant as sensors
and history entries.

### How it works
Once configured (username/password in `configuration.yaml`), Home Assistant polls
the API daily and exposes:

```yaml
sensor.ov_balance:          "€ 12,40"
sensor.ov_trips_this_month: 23
sensor.ov_spend_this_month: "€ 38,20"
sensor.ov_last_trip_from:   "Amsterdam Centraal"
sensor.ov_last_trip_to:     "Utrecht Centraal"
sensor.ov_last_trip_time:   "2024-06-07T17:42:00"
```

A Lovelace dashboard card shows the monthly spend trend and a mini map of
recent trips (using the `map` card with custom entities).

### Stack
- Python `custom_component` in `~/.homeassistant/custom_components/overzicht/`
- `aiohttp` for async API calls
- Alternatively packaged for HACS (Home Assistant Community Store) for one-click install

### Why it's good
- Spending automatically appears in your energy/finance dashboard
- Trigger automations: "if I checked in at the station, turn off the lights at home"
- Long-term trends stored in HA's recorder DB — no manual exports needed
- Most technically interesting of the three: real integration, not a one-shot script

---

## Comparison

| | CLI/TUI | Static site | Home Assistant |
|---|---|---|---|
| Effort to build | Low | Medium | Medium–High |
| Requires HA | No | No | Yes |
| Always up-to-date | No (run manually) | No (run manually) | Yes (daily poll) |
| Shareable | Via file | Via HTML file | Via dashboard |
| Best for | Power users | One-time deep dive | Smart home users |
