# OVerzicht Extension — Implementation Plan

## Goal

A Firefox/Chrome extension that, when the user is logged in to ov-chipkaart.nl,
injects a button next to their card name. On click it fetches up to a year of
travel history (including check-ins via the ID trick), parses the CSV, and renders
visualizations — all inside the browser using the live session.

---

## Why the browser extension avoids the "malicious IP" problem

The Python script made requests from a machine with a different IP than the browser
session. The extension makes requests **from the browser itself**, so the session
cookies, IP, User-Agent, and TLS fingerprint all match what the server expects.
Still, we add polite delays between chunked requests to stay well under any rate limits.

---

## Architecture

```
ov-chipkaart.nl page
      │
      ├─ content_script.js   ← injected by extension; owns all page manipulation
      │       │
      │       ├─ detects login & card element → injects "OVerzicht" button
      │       ├─ on button click → starts fetch pipeline
      │       └─ renders visualization overlay / panel
      │
      └─ (no background script needed for MVP)
```

No background service worker is needed because the content script runs in page
context and can piggyback on the page's own session cookies via `fetch()`.

---

## Phase 1 — API Reverse Engineering

Before writing feature code, capture the full API flow by extending the XHR interceptor
to log every request to `/backend/`:

1. Log all XHR/fetch calls to the backend (URL, method, body).
2. Identify the **listing endpoint** (the request that populates the transaction table).
3. Confirm how the date range is passed.
4. Confirm how the active card is identified.
5. Establish the safe chunk size (how many days per request without triggering rate limits).

Deliverable: fill in `research/api_notes.md` with confirmed endpoint shapes.

---

## Phase 2 — Data Fetching Pipeline

```
fetchYearOfTravels(cardId)
  │
  ├─ chunk date range into N slices (e.g. monthly chunks, ~12 requests)
  │   with 500 ms delay between requests
  │
  ├─ per chunk: POST listing endpoint → get transaction list + max ID
  │
  ├─ apply ID trick: fill all IDs 1..maxId with isSelected=true
  │
  ├─ POST generatedocument → get base64 CSV
  │
  └─ decode + parse CSV → return array of trip objects
```

Key concerns:
- **Rate limiting**: sequential requests with a 500 ms gap; exponential backoff on 429.
- **Large ID ranges**: IDs may not start at 1 per card — discover the actual min/max from
  the listing response rather than hardcoding `1..maxId`.
- **Pagination**: if the listing endpoint paginates, collect all pages before exporting.

---

## Phase 3 — Button Injection

CSS selector for the card element: **TBD** (needs live page inspection).

The content script should:
1. Wait for the element to appear (MutationObserver, not fragile `setTimeout`).
2. Inject a styled `<button>` next to the card name with the OVerzicht logo.
3. Show a progress indicator while fetching.
4. On error show a user-friendly Dutch message.

---

## Phase 4 — Visualizations

Show an in-page slide-over panel (or dedicated tab) with:

| Chart | Library | Description |
|---|---|---|
| Monthly spend bar chart | Chart.js | Euro total per month |
| Transport mode breakdown | Chart.js (doughnut) | Train / bus / tram / metro split |
| Top-10 routes | simple HTML table | Most frequent origin→destination pairs |
| Spending over time | Chart.js (line) | Cumulative cost curve |
| Day-of-week heatmap | D3 or custom SVG | When you travel most |

Chart.js (~60 KB gzipped) loaded from the extension bundle — no CDN calls.

---

## Phase 5 — Manifest & Cross-browser Support

| Feature | Firefox (MV2) | Chrome (MV3) |
|---|---|---|
| Background | background page | service worker |
| XHR intercept | content script ok | content script ok |
| `fetch` in content | yes | yes |
| `webRequestBlocking` | yes | removed in MV3 |

**Decision needed**: ship Firefox-first (MV2) or target both from the start (MV3)?
MV3 requires rewriting the XHR interceptor to use `declarativeNetRequest` for
header modification — but for this use case we only need to READ headers, not block,
so a pure `fetch`-based approach from the content script works in both.

Recommended: **single MV3 manifest** with a `browser_specific_settings` block for Firefox.
This avoids maintaining two manifests.

---

## Open Questions (for user)

1. **Browser target**: Firefox only, Chrome only, or both?
2. **Visualization priority**: which 2-3 charts matter most to you?
3. **Display style**: in-page overlay panel, or open a new tab?
4. **CSV or in-memory**: should we also offer a "download CSV" button, or just show the viz?
5. **Card selection**: do you have multiple OV cards, or always just one?

---

## File Layout (target state)

```
web_extension/
  manifest.json              ← MV3, with Firefox compat block
  content_script.js          ← button injection + fetch pipeline + viz rendering
  lib/
    chart.min.js             ← bundled Chart.js (no CDN)
    csv_parser.js            ← lightweight CSV → object array
  viz/
    panel.html               ← shadow DOM template for the overlay panel
    panel.css
  icons/
    trein-48.png
    trein-96.png
```

---

## What NOT to do

- Do not use `webRequestBlocking` to intercept and modify requests mid-flight — fragile,
  requires extra permissions, and breaks in Chrome MV3.
- Do not replay requests from a background script — keep everything in the content script
  so session cookies are automatically included.
- Do not hammer the API with parallel requests — sequential chunks with delays.
