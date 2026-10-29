// DW-01 (appairage), DW-03 (poste révoqué). Aucun accès au réseau depuis cette page : tout passe par le
// cœur Rust (probe_server, pair_device), qui vérifie l'autorité et parle au serveur en TLS épinglé.
'use strict';
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);

function showError(e) {
  $('error').textContent = typeof e === 'string' ? e : 'Erreur inattendue.';
  $('error').hidden = false;
}

if (new URLSearchParams(location.search).get('revoked') === '1') $('revoked').hidden = false;

$('step1').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('error').hidden = true;
  const button = ev.target.querySelector('button');
  button.disabled = true;
  try {
    const r = await invoke('probe_server', { address: $('address').value });
    $('origin').textContent = r.origin;
    $('fingerprint').textContent = r.fingerprint;
    $('step1').hidden = true;
    $('step2').hidden = false;
    $('name').focus();
  } catch (e) {
    showError(e);
  } finally {
    button.disabled = false;
  }
});

$('back').addEventListener('click', () => {
  $('step2').hidden = true;
  $('step1').hidden = false;
  $('address').focus();
});

$('step2').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('error').hidden = true;
  const button = ev.target.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await invoke('pair_device', { code: $('code').value, name: $('name').value });
    $('step2').hidden = true;
    $('done').hidden = false;
  } catch (e) {
    showError(e);
    $('code').value = '';
    $('code').focus();
  } finally {
    button.disabled = false;
  }
});
