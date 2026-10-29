// DW-06 : réglage de l'imprimante du poste (stocké dans la configuration locale de l'application).
'use strict';
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const say = (t, ok) => {
  $('status').textContent = t;
  $('status').className = ok ? 'ok' : 'error';
};

invoke('get_printer').then((p) => ($('address').value = p.address || ''));

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await invoke('set_printer', { address: $('address').value });
    say('Enregistré.', true);
  } catch (e) {
    say(String(e), false);
  }
});

$('test').addEventListener('click', async () => {
  try {
    await invoke('set_printer', { address: $('address').value });
    await invoke('test_printer');
    say('Ticket de test envoyé.', true);
  } catch (e) {
    say(String(e), false);
  }
});
