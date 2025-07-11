chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    if (details.method === "POST" && details.requestBody) {
      // You can read the raw request body here
      const raw = details.requestBody.raw;
      if (raw && raw.length) {
        const decoded = new TextDecoder("utf-8").decode(raw[0].bytes);
        console.log("Request body:", decoded);

        // But you cannot modify it here!
      }
    }
  },
  {urls: ["https://www.ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument*"]},
  ["blocking", "requestBody"]
);
