// DW-05 : fenêtre de mise à jour (W-07). La signature est vérifiée par le cœur Rust avant installation.
'use strict';
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

invoke('pending_update').then((u) => {
  if (!u) {
    window.close();
    return;
  }
  $('version').textContent = u.version;
  $('notes').textContent = u.notes || '';
});

$('install').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  $('status').textContent = 'Téléchargement et vérification de la signature…';
  try {
    await invoke('install_update');
  } catch (e) {
    $('status').textContent = `Mise à jour refusée : ${e}`;
    $('status').className = 'error';
    ev.target.disabled = false;
  }
});

$('later').addEventListener('click', () => window.close());
