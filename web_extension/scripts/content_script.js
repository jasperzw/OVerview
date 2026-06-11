/**
 * Content script for ov-chipkaart.nl.
 *
 * Confirmed API (captured 2026-06-08):
 *   GET  /backend/moc/cards/retrieve
 *   GET  /backend/moc/cards/retrievedetails?hashedMediumId=<id>
 *   POST /backend/moc/cardtravelhistory/cardtransactions
 *        body: { mediumId, expiryDate, dateFilter:{start,end}, transactionKindFilter:null }
 *        resp: { totalItems, cardTransactionSummaries:[{ transactionId, checkInInfo, ... }] }
 *   POST /backend/moc/cardtravelhistory/generatedocument
 *        body: { mediumId, expiryDate, documentFormat:"COMMA_SEPARATED_VALUE",
 *                dateFilter:{start,end}, transactionKindFilter:null,
 *                selectedTransactions:[{ id, isSelected }] }
 *        resp: { document:{ content:"<base64 CSV>" } }
 *
 * CSV columns (semicolon-separated):
 *   Datum;Check-in;Vertrek;Check-uit;Bestemming;Bedrag;Transactie;Klasse;Product;Opmerkingen;Naam;Kaartnummer
 */

const BASE = 'https://www.ov-chipkaart.nl/backend/moc';

// ─── Button injection ─────────────────────────────────────────────────────────

// Confirmed class from live capture 2026-06-08: span.z02f8dvw is the card name span
// inside li.sga5ez2 > div.sga5ez3. Hashed classnames may change on site updates.
const NAME_SPAN_SELECTOR  = 'span.z02f8dvw';
const FALLBACK_SELECTORS  = 'li.sga5ez2, [class*="card-name"], [class*="cardName"]';

function injectButtons() {
  // Prefer the confirmed name-span selector; fall back to broader patterns
  let candidates = Array.from(document.querySelectorAll(NAME_SPAN_SELECTOR));
  if (!candidates.length) {
    candidates = Array.from(document.querySelectorAll(FALLBACK_SELECTORS));
  }

  for (const found of candidates) {
    // Walk up to the nearest <li> so the button lives between card rows
    let anchor = found;
    while (anchor && anchor.tagName !== 'LI' && anchor.tagName !== 'BODY') {
      anchor = anchor.parentElement;
    }
    if (!anchor || anchor.tagName === 'BODY') anchor = found;

    // Skip if we already added a button for this card row
    if (anchor.dataset.overzichtDone) continue;
    anchor.dataset.overzichtDone = '1';

    const cardName = found.textContent?.trim() ?? 'kaart';

    const btn = document.createElement('button');
    btn.className   = 'overzicht-btn';
    btn.textContent = '🗺 OVerzicht';
    btn.title       = `Haal tot ${HISTORY_YEARS} jaar reishistorie op voor ${cardName}`;
    btn.style.cssText = `
      display: block;
      margin: 6px 0 6px 32px;
      padding: 4px 12px;
      background: #003082;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 0.82em;
      cursor: pointer;
    `;

    btn.addEventListener('click', () => onButtonClick(btn));
    anchor.insertAdjacentElement('afterend', btn);
    console.info('[OVerzicht] button injected for', cardName);
  }
}

const observer = new MutationObserver(injectButtons);

// document.body is null at document_start — wait for it
function startObserving() {
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    injectButtons();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
      injectButtons();
    }, { once: true });
  }
}
startObserving();

// ─── Button click handler ─────────────────────────────────────────────────────

async function onButtonClick(btn) {
  btn.disabled    = true;
  btn.textContent = '📡 Ophalen…';

  try {
    if (!window.__overzichtCapturedHeaders || Object.keys(window.__overzichtCapturedHeaders).length === 0) {
      console.warn('[OVerzicht] geen captured headers — xhr_logger heeft nog geen Angular request gezien');
    }
    const allTrips = await fetchAllCards();

    btn.textContent = `💾 ${allTrips.length} ritten opslaan…`;
    chrome.runtime.sendMessage(
      { type: 'SAVE_AND_OPEN', trips: allTrips },
      () => {
        btn.textContent = '✅ Klaar!';
        setTimeout(() => { btn.disabled = false; btn.textContent = '🗺 OVerzicht'; }, 2000);
      }
    );
  } catch (err) {
    console.error('[OVerzicht]', err);
    btn.textContent = '❌ ' + err.message;
    setTimeout(() => { btn.disabled = false; btn.textContent = '🗺 OVerzicht'; }, 4000);
  }
}

// ─── Page-context fetch bridge ────────────────────────────────────────────────
// Direct extension-context fetches get Sec-Fetch-Site:cross-site which the
// ov-chipkaart.nl backend rejects with 500. Instead we inject api_bridge.js
// into the page and proxy all calls through it (same-origin, correct headers).

let bridgeReady = false;

function injectScript(filename) {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL(`scripts/${filename}`);
  const target = document.head ?? document.documentElement;
  if (target) {
    target.appendChild(s);
    s.remove();
  } else {
    // True document_start race: documentElement not yet created
    new MutationObserver((_, obs) => {
      const t = document.head ?? document.documentElement;
      if (t) { obs.disconnect(); t.appendChild(s); s.remove(); }
    }).observe(document, { childList: true });
  }
}

function injectBridge() {
  if (bridgeReady) return;
  bridgeReady = true;
  injectScript('xhr_logger.js');
  injectScript('api_bridge.js');
}

function pageFetch(method, path, body) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const url = `${BASE}${path}`;

    console.debug(`[OV] ${method} ${url}`, body ?? '');

    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(`Timeout: ${method} ${path}`));
    }, 30_000);

    function handler(event) {
      if (event.source !== window || !event.data?.__overzicht_result) return;
      if (event.data.id !== id) return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);

      const { status, body: text, error } = event.data;
      if (error) { reject(new Error(`${method} ${path}: ${error}`)); return; }

      console.debug(`[OV] ${method} ${url} → ${status}`);

      // Present a minimal response-like object so callers use .ok + .json()
      resolve({
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(JSON.parse(text)),
        text:   () => Promise.resolve(text),
      });
    }

    window.addEventListener('message', handler);
    window.postMessage({
      __overzicht_call: true,
      id,
      method,
      url,
      body: body ? JSON.stringify(body) : null,
    }, '*');
  });
}

function apiGet(path)        { return pageFetch('GET',  path); }
function apiPost(path, body) { return pageFetch('POST', path, body); }

async function readErrorBody(resp) {
  try { return await resp.text(); } catch { return '(no body)'; }
}

function checkBlocked(resp, path) {
  // 471 = link11 WAF block, almost always means the Bearer token expired
  if (resp.status === 471) {
    throw new Error(
      `Sessie verlopen (HTTP 471 op ${path}). Herlaad de pagina en probeer opnieuw.`
    );
  }
}

// Inject immediately so the bridge is live before any button click
injectBridge();

// ─── Date chunking ────────────────────────────────────────────────────────────
// The API uses 30-day windows. Requesting a full year in one call returns HTTP 500.

function dateChunks(from, to, chunkDays = 30) {
  const fmt     = (d) => d.toISOString().slice(0, 10);
  const chunks  = [];
  let cursor    = new Date(from);
  while (cursor < to) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + chunkDays - 1);
    if (end > to) end.setTime(to.getTime());
    chunks.push({ start: fmt(cursor), end: fmt(end) });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

// ─── Data pipeline ────────────────────────────────────────────────────────────

// How far back to try. Unclear whether the backend keeps more than a year;
// chunks are therefore fetched newest → oldest and we stop going further back
// once chunks older than a year consistently return nothing. Worst case the
// result is exactly the old 1-year scrape.
const HISTORY_YEARS = 5;
// Consecutive no-data chunks (>1 jaar oud) before giving up. Generous on
// purpose: 8 chunks = 240 days, so a half-year travel gap (e.g. living
// abroad) doesn't get mistaken for the backend's retention limit.
const MAX_EMPTY_OLD_CHUNKS = 8;

async function fetchAllCards() {
  console.group('OVerzicht fetch');

  console.info('[OV] Tip: open het Network-tabblad in DevTools om de exacte request headers te zien');

  // ── 1. Card list ──────────────────────────────────────────────────────────
  console.group('1 · /cards/retrieve');
  const cardsResp = await apiGet('/cards/retrieve');
  checkBlocked(cardsResp, '/cards/retrieve');
  if (!cardsResp.ok) {
    const body = await readErrorBody(cardsResp);
    console.error(`❌ HTTP ${cardsResp.status} op /cards/retrieve`);
    console.error('Server response body:', body || '(leeg)');
    console.groupEnd(); console.groupEnd();
    throw new Error(`Kaartlijst mislukt: HTTP ${cardsResp.status}`);
  }
  const { cards } = await cardsResp.json();
  console.info(`✅ ${cards.length} kaarten:`, cards.map(c => `${c.alias} (${c.mediumId})`));
  console.groupEnd();

  const today        = new Date();
  const historyStart = new Date(today);
  historyStart.setFullYear(historyStart.getFullYear() - HISTORY_YEARS);
  const yearBoundary = new Date(today);
  yearBoundary.setFullYear(yearBoundary.getFullYear() - 1);
  const allTrips = [];

  for (const card of cards) {
    console.group(`Kaart: ${card.alias}`);

    // ── 2. Card details (expiryDate) ────────────────────────────────────────
    console.group('2 · /cards/retrievedetails');
    const detailResp = await apiGet(
      `/cards/retrievedetails?hashedMediumId=${encodeURIComponent(card.hashedMediumId)}`
    );
    checkBlocked(detailResp, '/cards/retrievedetails');
    if (!detailResp.ok) {
      const body = await readErrorBody(detailResp);
      console.warn(`HTTP ${detailResp.status} — kaart overgeslagen`, body);
      console.groupEnd(); console.groupEnd();
      continue;
    }
    const detail     = await detailResp.json();
    const expiryDate = detail.cardStatus?.expiryDate ?? detail.expiryDate;
    if (!expiryDate) {
      console.warn('Geen expiryDate gevonden. Volledige response:', detail);
      console.groupEnd(); console.groupEnd();
      continue;
    }
    console.info('expiryDate:', expiryDate);
    console.info('cardStatus:', detail.cardStatus ?? '(niet aanwezig)');
    console.groupEnd();

    // ── 3-5. Per 30-day chunk, newest first ─────────────────────────────────
    // The last year is always fetched in full (failures only skip that chunk,
    // as before). Chunks older than a year are exploratory: after
    // MAX_EMPTY_OLD_CHUNKS consecutive chunks without data we assume the
    // backend's retention limit is reached and stop going further back.
    const chunks = dateChunks(historyStart, today, 30).reverse();
    console.info(`${chunks.length} chunks (30 dagen elk, nieuwste eerst, tot ${HISTORY_YEARS} jaar terug)`);
    let cardTrips = 0;
    let emptyOldStreak = 0;
    const chunkResults = []; // newest first; reversed before storing

    for (const { start, end } of chunks) {
      const olderThanYear = new Date(end) < yearBoundary;
      if (olderThanYear && emptyOldStreak >= MAX_EMPTY_OLD_CHUNKS) {
        console.info(`${emptyOldStreak} opeenvolgende chunks ouder dan een jaar zonder data — ` +
          'bewaartermijn bereikt, stop met verder teruggaan');
        break;
      }
      const markEmpty = () => { if (olderThanYear) emptyOldStreak++; };
      console.group(`Chunk ${start} → ${end}`);

      // 3 · cardtransactions
      const txBody = {
        mediumId:              card.mediumId,
        expiryDate,
        dateFilter:            { start, end },
        transactionKindFilter: null,
      };
      const txResp = await apiPost('/cardtravelhistory/cardtransactions', txBody);
      if (!txResp.ok) {
        const body = await readErrorBody(txResp);
        console.warn(`cardtransactions HTTP ${txResp.status}`, body);
        markEmpty();
        console.groupEnd();
        continue;
      }
      const txData       = await txResp.json();
      const transactions = txData.cardTransactionSummaries ?? [];
      console.info(`totalItems: ${txData.totalItems ?? '?'}, returned: ${transactions.length}`);
      if (!transactions.length) { markEmpty(); console.groupEnd(); continue; }

      const ids = transactions.map(t => t.transactionId);
      console.info('transactionIds:', ids);

      // 4 · select all (force check-ins in)
      const selectedTransactions = ids.map(id => ({ id, isSelected: true }));

      // 5 · generatedocument
      const docBody = {
        mediumId:              card.mediumId,
        expiryDate,
        documentFormat:        'COMMA_SEPARATED_VALUE',
        dateFilter:            { start, end },
        transactionKindFilter: null,
        selectedTransactions,
      };
      const docResp = await apiPost('/cardtravelhistory/generatedocument', docBody);
      if (!docResp.ok) {
        const body = await readErrorBody(docResp);
        console.warn(`generatedocument HTTP ${docResp.status}`, body);
        markEmpty();
        console.groupEnd();
        continue;
      }
      const docData = await docResp.json();
      console.info('generatedocument response keys:', Object.keys(docData));

      const b64 = docData.document?.content
                ?? docData.content
                ?? docData.file
                ?? docData.data
                ?? findFirstBase64(docData);
      if (!b64) {
        console.warn('Geen base64 content gevonden. Response:', docData);
        markEmpty();
        console.groupEnd();
        continue;
      }
      console.info(`base64 lengte: ${b64.length} chars`);

      const csvText = atob(b64);
      console.info('CSV preview:\n' + csvText.slice(0, 300));

      const trips = parseOVCsv(csvText, card.alias);
      console.info(`${trips.length} ritten geparsed`);
      if (trips.length) {
        emptyOldStreak = 0;
        chunkResults.push(trips);
        cardTrips += trips.length;
      } else {
        markEmpty();
      }

      console.groupEnd(); // chunk
    }

    // Chunks were fetched newest-first; store oldest-first so the row order
    // (check-in before its journey row) stays the same as the 1-year scrape —
    // mergeJourneys in the dashboard depends on it across chunk boundaries.
    chunkResults.reverse();
    for (const trips of chunkResults) allTrips.push(...trips);

    console.info(`Totaal voor ${card.alias}: ${cardTrips} ritten`);
    console.groupEnd(); // card
  }

  console.info(`Klaar. Totaal alle kaarten: ${allTrips.length} ritten`);
  console.groupEnd(); // OVerzicht fetch
  return allTrips;
}

function findFirstBase64(obj, depth = 0) {
  if (depth > 5) return null;
  if (typeof obj === 'string' && /^[A-Za-z0-9+/]{50,}={0,2}$/.test(obj)) return obj;
  if (typeof obj === 'object' && obj !== null) {
    for (const v of Object.values(obj)) {
      const found = findFirstBase64(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Actual columns (English): Date;Check-in;Departure;Check-out;Destination;Amount;
//                           Transaction;Class;Product;Comments;Name;Card number

function parseOVCsv(csvText, cardAlias) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const sep     = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
  console.debug('CSV headers:', headers);

  const trips = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], sep);
    if (cols.length < 3) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? '').trim().replace(/^"|"$/g, '');
    });

    const trip = normaliseRow(row, cardAlias);
    if (trip) trips.push(trip);
  }

  return trips;
}

function splitCsvLine(line, sep) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"')                  { inQuotes = !inQuotes; }
    else if (ch === sep && !inQuotes){ result.push(current); current = ''; }
    else                             { current += ch; }
  }
  result.push(current);
  return result;
}

function normaliseRow(row, cardAlias) {
  const from = (row['Departure']   ?? '').trim();
  const to   = (row['Destination'] ?? '').trim();
  if (!from && !to) return null;

  // Amount is formatted as "€ 4,50" or "-€ 4,50" or "0,00" or plain "4.50"
  const amountStr = (row['Amount'] ?? '0').replace('€', '').replace(/\s/g, '').replace(',', '.');
  const amount    = parseFloat(amountStr) || 0;

  const product = row['Product']     ?? '';
  const txType  = row['Transaction'] ?? '';

  return {
    date:     row['Date']      ?? '',
    checkIn:  row['Check-in']  ?? '',
    from,
    checkOut: row['Check-out'] ?? '',
    to,
    amount:   Math.abs(amount),
    debit:    amount < 0 ? 'Af' : (amount > 0 ? 'Bij' : ''),
    product,
    txType,
    note:     row['Comments']  ?? '',
    card:     cardAlias,
    // Shared inference from dashboard/matching.js (loaded before this script
    // via manifest.json). The dashboard re-derives this on load anyway, so
    // cached trips from older versions stay correct too.
    operator: OVMatch.inferOperator(product, txType, from, to),
  };
}
