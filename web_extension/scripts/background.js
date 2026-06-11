// Service worker / background page.
// Receives already-fetched trip data from content_script.js and opens the dashboard.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    return false;
  }

  if (message.type === 'SAVE_AND_OPEN') {
    chrome.storage.local.set(
      { trips: message.trips, fetchedAt: Date.now() },
      () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
        sendResponse({ ok: true });
      }
    );
    return true; // keep channel open for async response
  }
});
