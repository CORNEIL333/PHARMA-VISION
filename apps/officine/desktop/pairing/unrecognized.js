// DW-02 : écran bloquant ; seule action possible : réessayer (aucun moyen de passer outre).
'use strict';
const reason = new URLSearchParams(location.search).get('reason');
document.getElementById('reason').textContent = reason ? `Détail : ${reason}` : '';
document.getElementById('retry').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  try {
    await window.__TAURI_INTERNALS__.invoke('retry_connection');
  } finally {
    ev.target.disabled = false;
  }
});
