chrome.storage.local.get(['trips', 'fetchedAt'], ({ trips, fetchedAt }) => {
  if (trips?.length) {
    document.getElementById('instruction').classList.add('hidden');

    const btn = document.getElementById('btn-open');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    });

    if (fetchedAt) {
      const age = document.getElementById('data-age');
      const h   = Math.round((Date.now() - fetchedAt) / 3600000);
      age.textContent = `${trips.length} ritten · ${h}u oud`;
      age.classList.remove('hidden');
    }
  }
});
