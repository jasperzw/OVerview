(function () {
  window.__overzichtCapturedHeaders = window.__overzichtCapturedHeaders ?? {};

  function headersToObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) {
      const out = {};
      headers.forEach((v, k) => { out[k] = v; });
      return out;
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers);
    }
    return { ...headers };
  }

  const AUTH_HEADER_PATTERNS = ['xsrf', 'csrf', 'authorization', 'x-auth', 'bearer', 'angular'];

  function isAuthHeader(name) {
    const n = name.toLowerCase();
    return AUTH_HEADER_PATTERNS.some(p => n.includes(p));
  }

  function captureAuthHeaders(requestHeaders) {
    const captured = {};
    for (const [k, v] of Object.entries(requestHeaders)) {
      if (isAuthHeader(k)) captured[k] = v;
    }
    if (Object.keys(captured).length > 0) {
      Object.assign(window.__overzichtCapturedHeaders, captured);
      // Persist so api_bridge can use the token even when Angular makes no fresh requests
      try {
        sessionStorage.setItem('__overzicht_auth', JSON.stringify({ headers: captured, ts: Date.now() }));
      } catch (_) {}
      console.info('[OVerzicht XHR] auth headers gecaptured:', Object.keys(captured).join(', '));
    }
  }

  function notifyContentScript(data) {
    window.postMessage({ __overzicht: true, ...data }, '*');
    console.log('[OVerzicht XHR]', data.method, data.url, '→', data.status,
      '\nREQ headers:', Object.keys(data.requestHeaders ?? {}).join(', ') || '(geen)',
      '\nREQ:', data.requestBody,
      '\nRES:', data.responseBody?.slice(0, 300));
  }

  // --- XHR intercept ---
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = '';
    let _method = '';
    const _requestHeaders = {};

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _url = url;
      _method = method;
      return origOpen(method, url, ...rest);
    };

    const origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (name, value) {
      _requestHeaders[name] = value;
      return origSetRequestHeader(name, value);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
      if (_url.includes('/backend/')) {
        xhr.addEventListener('load', function () {
          if (xhr.status === 200) captureAuthHeaders(_requestHeaders);
          notifyContentScript({
            type: 'XHR',
            url: _url,
            method: _method,
            requestHeaders: { ..._requestHeaders },
            requestBody: body,
            status: xhr.status,
            responseBody: xhr.responseText,
          });
        });
      }
      return origSend(body);
    };

    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // --- fetch intercept ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const url = typeof request === 'string' ? request : request?.url ?? '';

    if (!url.includes('/backend/')) {
      return origFetch(...args);
    }

    let requestBody = null;
    let requestHeaders = {};
    try {
      const init = args[1] ?? {};
      requestBody = init.body ?? null;
      if (requestBody instanceof ReadableStream) requestBody = '<stream>';
      requestHeaders = headersToObject(init.headers ?? (request instanceof Request ? request.headers : null));
    } catch (_) {}

    console.info('[OVerzicht XHR] fetch naar /backend/, request headers:',
      Object.keys(requestHeaders).join(', ') || '(geen)');

    const response = await origFetch(...args);
    const clone = response.clone();

    clone.text().then((responseBody) => {
      if (response.status === 200) captureAuthHeaders(requestHeaders);
      notifyContentScript({
        type: 'FETCH',
        url,
        method: (args[1]?.method ?? 'GET').toUpperCase(),
        requestHeaders,
        requestBody,
        status: response.status,
        responseBody,
      });
    });

    return response;
  };
})();
