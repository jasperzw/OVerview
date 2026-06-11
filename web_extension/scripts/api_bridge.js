(function () {
  console.info('[OV bridge] loaded');

  function findCookieByPattern(patterns) {
    const pairs = document.cookie.split(';').map(c => c.trim());
    for (const pair of pairs) {
      const name = pair.split('=')[0];
      const nameLower = name.toLowerCase();
      for (const pat of patterns) {
        if (nameLower.includes(pat.toLowerCase())) {
          const val = pair.slice(pair.indexOf('=') + 1);
          return { name, value: decodeURIComponent(val) };
        }
      }
    }
    return null;
  }

  const cookieNames = document.cookie
    .split(';')
    .map(c => c.trim().split('=')[0])
    .filter(Boolean);
  console.info('[OV bridge] cookies aanwezig:', cookieNames.join(', ') || '(geen)');

  function findStorageToken() {
    const patterns = ['token', 'bearer', 'auth', 'jwt', 'authorization'];
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (!key) continue;
          if (patterns.some(p => key.toLowerCase().includes(p))) {
            console.info('[OV bridge] storage token gevonden:', key,
              '(in', store === localStorage ? 'localStorage' : 'sessionStorage', ')');
            return store.getItem(key);
          }
        }
      } catch (_) {}
    }
    return null;
  }

  // Pre-populate captured headers from sessionStorage so button clicks work
  // even when Angular hasn't made any fresh /backend/ requests this page load.
  try {
    const stored = sessionStorage.getItem('__overzicht_auth');
    if (stored) {
      const { headers: h, ts } = JSON.parse(stored);
      if (Date.now() - ts < 3_600_000) {
        window.__overzichtCapturedHeaders = window.__overzichtCapturedHeaders ?? {};
        Object.assign(window.__overzichtCapturedHeaders, h);
        console.info('[OV bridge] auth hersteld uit sessionStorage:', Object.keys(h).join(', '));
      }
    }
  } catch (_) {}

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data?.__overzicht_call) return;

    const { id, method, url, body } = event.data;

    const xsrfMatch = findCookieByPattern(['XSRF-TOKEN', 'XSRF', 'csrf', 'angular']);
    if (xsrfMatch) {
      console.info('[OV bridge] XSRF cookie gevonden:', xsrfMatch.name);
    } else {
      console.info('[OV bridge] geen XSRF cookie gevonden');
    }

    const headers = {
      Accept:             'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (xsrfMatch) headers['X-XSRF-TOKEN'] = xsrfMatch.value;
    if (body)      headers['Content-Type']  = 'application/json';

    // Do NOT send storage tokens directly — they are often encrypted blobs.
    // xhr_logger.js captures the correct Bearer token from Angular's own requests.
    findStorageToken(); // still logs what keys exist, for debugging

    const captured = window.__overzichtCapturedHeaders;
    if (captured && Object.keys(captured).length > 0) {
      console.info('[OV bridge] captured headers gebruikt:', Object.keys(captured).join(', '));
      for (const [k, v] of Object.entries(captured)) {
        if (!headers[k]) headers[k] = v;
      }
    } else {
      console.info('[OV bridge] geen captured headers beschikbaar');
    }

    console.info(`[OV bridge] → ${method} ${url.replace('https://www.ov-chipkaart.nl', '')}`,
      `xsrf:${xsrfMatch ? '✓' : '✗'}`,
      'headers verzonden:', Object.keys(headers).join(', '));

    try {
      const resp = await fetch(url, {
        method:      method ?? 'GET',
        credentials: 'include',
        headers,
        ...(body ? { body } : {}),
      });

      const text = await resp.text();

      if (resp.ok) {
        console.info(`[OV bridge] ← ${resp.status} OK (${text.length} bytes)`);
      } else {
        console.warn(`[OV bridge] ← ${resp.status} FOUT — server response body:`);
        console.warn(text);
      }

      window.postMessage({ __overzicht_result: true, id, status: resp.status, body: text }, '*');
    } catch (err) {
      console.error('[OV bridge] fetch exception:', err.message);
      window.postMessage({ __overzicht_result: true, id, status: 0, error: err.message }, '*');
    }
  });
})();
