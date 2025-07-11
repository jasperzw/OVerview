browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (
      details.method === "POST" &&
      details.url.includes("ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument")
    ) {
      console.log("Intercepted request, saving headers");

      // Save headers for reuse
      const savedHeaders = details.requestHeaders;

      // Prepare headers object for fetch
      const headersObj = {};
      for (const header of savedHeaders) {
        if (
          header.name.toLowerCase() === "content-length" ||
          header.name.toLowerCase() === "host" ||
          header.name.toLowerCase() === "origin" ||
          header.name.toLowerCase() === "referer"
        ) continue;
        headersObj[header.name] = header.value;
      }

        const oneYearMs = 365 * 24 * 60 * 60 * 1000;

        const customBody = {
        dateFilter: {
            end: Date.now(),
            start: Date.now() - oneYearMs
        },
        documentFormat: "COMMA_SEPARATED_VALUE",
        expiryDate: "2028-08-09",
        mediumId: "3528050050719915",
        selectedTransactions: Array.from({ length: 1500 }, (_, i) => ({
            id: i + 1,
            isSelected: true
        })),
        transactionKindFilter: null
        };


      // Fire the new fetch request with the original headers + custom body
      fetch("https://www.ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument", {
        method: "POST",
        headers: headersObj,
        body: JSON.stringify(customBody),
        credentials: "include"
      })
      .then(response => response.json())
      .then(data => console.log("Custom request response:", data))
      .catch(console.error);

      // Cancel the original request
      return { cancel: true };
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "blocking"]
);
