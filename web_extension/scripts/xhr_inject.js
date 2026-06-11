(function () {
  const originalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new originalXHR();

    const originalOpen = xhr.open;
    xhr.open = function (method, url) {
      this._url = url;
      this._method = method;
      return originalOpen.apply(this, arguments);
    };

    const originalSend = xhr.send;
    xhr.send = function (body) {
      if (this._url.includes("/generatedocument") && this._method === "POST") {
        try {
          const jsonData = JSON.parse(body);
          console.log("🚂 Intercepted XHR JSON request body:", jsonData);
        } catch (e) {
          console.warn("XHR body not JSON or parse failed:", body);
        }
      }
      return originalSend.apply(this, arguments);
    };

    return xhr;
  };
})();
