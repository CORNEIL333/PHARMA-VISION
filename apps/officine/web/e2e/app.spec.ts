import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiClient, axe, PASSWORD, shots, state, Totp } from './util';

/**
 * Scénario complet sur un vrai serveur : configuration (UI-01), connexion (UI-02), caisse au clavier
 * (UI-03, UI-04), ordonnance (UI-05), tous les écrans (UI-06 à UI-15), états globaux (UI-16),
 * droits par rôle. Chaque écran est contrôlé par axe et capturé en sombre et en clair.
 */
test.describe.configure({ mode: 'serial' });

const here = path.dirname(fileURLToPath(import.meta.url));
let context: BrowserContext;
let page: Page;
let totp: Totp;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-FR', timezoneId: 'Africa/Douala', viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

async function reauth() {
  const api = await apiClient(context.request);
  await api.post('/auth/reauth', { password: PASSWORD, code: await totp.next() });
  return api;
}

test('UI-01 configuration initiale : titulaire, TOTP, clé de récupération', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Configuration initiale de l'officine" })).toBeVisible();
  await expect(page.getByText(state().fingerprint)).toBeVisible();
  await axe(page, 'configuration');
  await shots(page, 'ui-01-configuration');
  await page.getByLabel("Nom de l'officine").fill('Pharmacie du Centre');
  await page.getByLabel('Nom affiché').fill('Dr Mballa');
  await page.getByLabel('Mot de passe (12 caractères au moins)').fill(PASSWORD);
  await page.getByLabel('Confirmer le mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  totp = new Totp(secret);
  await page.getByLabel('Code à 6 chiffres').fill(await totp.next());
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Clé de récupération').fill(state().recoveryKey);
  await page.getByRole('button', { name: 'Terminer la configuration' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
});

test('données de recette : catalogue importé, prix, fournisseur, réception', async () => {
  const api = await reauth();
  const csv = readFileSync(path.resolve(here, '../../data/catalogue-echantillon.csv'));
  const report = await api.csv('/catalog/import', csv);
  expect(report.inserted).toBeGreaterThan(100);
  const para = await api.post('/products/local', { name: 'Gel hydroalcoolique 100 ml', category: 'parapharmacie' });
  const med = (await api.get('/products?q=amoxicilline&limit=1')) as unknown as { items: { id: string }[] };
  ids.para = para.id;
  ids.med = med.items[0]!.id;
  await api.patch(`/products/${ids.para}/price`, { sale_price: 1500 });
  await api.patch(`/products/${ids.med}/price`, { sale_price: 2500 });
  ids.supplier = (await api.post('/suppliers', { name: 'Grossiste Douala', lead_days: 2 })).id;
  await api.post('/receptions', {
    supplier_id: ids.supplier,
    lines: [
      { product_id: ids.para, lot_number: 'GEL-01', expiry: '2028-06-30', qty: 40, unit_cost: 900 },
      { product_id: ids.med, lot_number: 'AMX-01', expiry: '2028-03-31', qty: 30, unit_cost: 1500 },
      { product_id: ids.med, lot_number: 'AMX-OLD', expiry: '2026-12-31', qty: 2, unit_cost: 1400, confirm_near_expiry: true },
    ],
  });
});

test('Dossier de l’officine : bandeau, saisie d’une rubrique, accessibilité', async () => {
  await page.goto('/caisse');
  await expect(page.getByText(/Dossier de l'officine incomplet \(0\/9\)/)).toBeVisible();
  await reauth();
  await page.getByRole('link', { name: 'Compléter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Dossier de l'officine" })).toBeVisible();
  await page.getByLabel('Enseigne (nom affiché) *').fill('Pharmacie du Centre');
  await page.getByLabel('Forme juridique *').selectOption('entreprise_individuelle');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Rubrique enregistrée')).toBeVisible();
  await expect(page.getByText('1/9 rubriques complètes')).toBeVisible();
  await page.getByRole('button', { name: 'Fiscalité et administration' }).click();
  await page.getByLabel('NIU (numéro d’identifiant unique) *').fill('M0123');
  await page.getByLabel("Régime d'imposition *").selectOption('reel');
  await page.getByLabel('Centre des impôts de rattachement *').fill('CIME Douala');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/niu : 10 à 20 lettres/).first()).toBeVisible();
  await page.getByLabel('NIU (numéro d’identifiant unique) *').fill('M012345678901A');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('2/9 rubriques complètes')).toBeVisible();
  await page.getByRole('button', { name: 'Horaires et garde' }).click();
  await axe(page, 'dossier');
  await shots(page, 'dossier-officine');
});

test('UI-03 UI-04 caisse au clavier : ouverture, recherche, quantité, paiement, rendu', async () => {
  await page.goto('/caisse');
  await page.getByLabel('Fond de caisse (XAF)').fill('20000');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  const scan = page.getByRole('combobox', { name: /Scanner un code-barres/ });
  await expect(scan).toBeFocused();
  await scan.fill('gel hydro');
  await expect(page.getByRole('option', { name: /Gel hydroalcoolique/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cart-total')).toHaveText(/1\s500\sF/);
  await page.keyboard.press('F4');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cart-total')).toHaveText(/4\s500\sF/);
  await axe(page, 'caisse');
  await shots(page, 'ui-03-caisse');
  await page.keyboard.press('F9');
  await expect(page.getByTestId('payment-total')).toHaveText(/4\s500\sF/);
  await page.getByLabel('Espèces remises').fill('5000');
  await expect(page.getByTestId('change')).toHaveText(/500\sF/);
  await axe(page, 'paiement');
  await shots(page, 'ui-04-paiement');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Vente enregistrée V-\d{4}-\d{6}/)).toBeVisible();
  await expect(page.getByText('Panier vide')).toBeVisible();
});

test('UI-05 O-02 ordonnance requise : blocage dans le panier puis validation', async () => {
  const scan = page.getByRole('combobox', { name: /Scanner un code-barres/ });
  await scan.fill('amoxicilline');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ordonnance requise' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paiement (F9)' })).toBeDisabled();
  await page.getByRole('button', { name: "Saisir l'ordonnance" }).click();
  await page.getByLabel('Prescripteur').fill('Dr Ekane');
  await page.getByLabel('Référence patient (initiales ou pseudonyme)').fill('J.N.');
  await axe(page, 'ordonnance');
  await shots(page, 'ui-05-ordonnance');
  await page.getByRole('button', { name: 'Valider l’ordonnance' }).click();
  await expect(page.getByText('Ordonnance liée')).toBeVisible();
  await expect(page.getByText('AMX-OLD · exp. 12/2026').first()).toBeVisible();
  await page.keyboard.press('F9');
  await page.getByTestId('confirm-sale').click();
  await expect(page.getByText(/Vente enregistrée/).last()).toBeVisible();
});

test('Q-02 lot rappelé : alerte bloquante au scan, dans le panier', async () => {
  const api = await reauth();
  await api.post('/recalls', { reference: 'DPML-2026-014', product_id: ids.para, lot_number: 'GEL-01', reason: 'Défaut d’étiquetage', source: 'DPML' });
  await page.goto('/caisse');
  const scan = page.getByRole('combobox', { name: /Scanner un code-barres/ });
  await scan.fill('gel hydro');
  await expect(page.getByRole('option', { name: /Gel hydroalcoolique/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Stock vendable insuffisant|régularisation/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Vider le panier' }).click();
});

const SCREENS: [string, string, string][] = [
  ['/produits', 'Produits et stock', 'ui-06-produits'],
  ['/reception', 'Réception', 'ui-07-reception'],
  ['/commandes', 'Commandes', 'ui-08-commandes'],
  ['/inventaire', 'Inventaire', 'ui-09-inventaire'],
  ['/rappels', 'Rappels', 'ui-10-rappels'],
  ['/demandes', 'Demandes non satisfaites', 'ui-11-demandes'],
  ['/rapports', 'Rapports', 'ui-12-rapports'],
  ['/comptes', 'Comptes', 'ui-13-comptes'],
  ['/systeme', 'Système', 'ui-14-systeme'],
  ['/cloture', 'Clôture de caisse', 'ui-15-cloture'],
];

for (const [url, title, shot] of SCREENS) {
  test(`${shot.slice(0, 5).toUpperCase()} écran ${title} : accessible, sombre et clair`, async () => {
    if (url === '/comptes') await reauth();
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await axe(page, title);
    await shots(page, shot);
  });
}

test('UI-06 C-06 S-09 fiche produit : prix et seuils modifiés', async () => {
  await page.goto(`/produits?id=${ids.para}`);
  await page.getByLabel("Prix de vente de l'officine").fill('1600');
  await page.getByLabel('Minimum').fill('5');
  await page.getByLabel('Maximum').fill('50');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByText('Enregistré').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'GEL-01' }).first()).toBeVisible();
  // C-07 : code interne et étiquettes imprimables.
  await page.getByRole('button', { name: 'Étiquettes' }).click();
  await expect(page.getByRole('img', { name: /^Code-barres 20\d{11}$/ }).first()).toBeVisible();
  await page.getByLabel("Nombre d'étiquettes").fill('3');
  await expect(page.getByRole('img', { name: /^Code-barres 20/ })).toHaveCount(3);
  await axe(page, 'étiquettes');
  await shots(page, 'c-07-etiquettes');
  await page.keyboard.press('Escape');
});

test('UI-15 V-08 clôture : écart calculé et rapport P-01', async () => {
  await page.goto('/cloture');
  await page.getByLabel('Espèces comptées (XAF)').fill('28000');
  await page.getByRole('button', { name: 'Clôturer la caisse' }).click();
  await expect(page.getByText(/Caisse clôturée/)).toBeVisible();
  await expect(page.getByText('Par mode de paiement')).toBeVisible();
});

test('UI-14 J-04 vérification du journal depuis l’écran Système', async () => {
  await page.goto('/systeme');
  await page.getByRole('button', { name: 'Vérifier le journal' }).click();
  await expect(page.getByText('Journal intègre')).toBeVisible();
  await expect(page.getByTestId('system-fingerprint')).toHaveText(state().fingerprint);
  // NO-01, NO-05 : synchronisation désactivée par défaut, aucun enrôlement.
  await page.getByRole('tab', { name: 'Synchronisation' }).click();
  await expect(page.getByText('Désactivée', { exact: true })).toBeVisible();
  await expect(page.getByText('Non enrôlée', { exact: true })).toBeVisible();
  await axe(page, 'synchronisation');
  await shots(page, 'no-05-synchronisation');
});

test('UI-16 états globaux : page introuvable, bandeau hors ligne, panier conservé', async () => {
  await page.goto('/inexistant');
  await expect(page.getByText('Page introuvable')).toBeVisible();
  await axe(page, 'introuvable');
  await shots(page, 'ui-16-introuvable');
  await page.goto('/caisse');
  await page.getByLabel('Fond de caisse (XAF)').fill('0');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  const scan = page.getByRole('combobox', { name: /Scanner un code-barres/ });
  await scan.fill('amoxicilline');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('list', { name: 'Lignes du panier' }).getByRole('listitem')).toHaveCount(1);
  await page.route('**/api/v1/**', (r) => r.abort());
  await scan.fill('12345678');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Serveur injoignable/).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Lignes du panier' }).getByRole('listitem')).toHaveCount(1);
  await shots(page, 'ui-16-hors-ligne');
  await page.unroute('**/api/v1/**');
});

test('UI-13 U-03 un caissier ne voit que ses écrans ; UI-02 connexion avec message générique', async ({ browser }) => {
  await reauth();
  await page.goto('/comptes');
  await page.getByRole('button', { name: 'Nouveau compte' }).click();
  await page.getByLabel('Identifiant').fill('caisse1');
  await page.getByLabel('Nom affiché').fill('Awa Caisse');
  await page.getByRole('button', { name: 'Créer' }).click();
  const temp = (await page.getByTestId('temp-password').textContent())!.trim();
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'fr-FR' });
  const p2 = await other.newPage();
  await p2.goto('/');
  await expect(p2.getByTestId('ca-fingerprint')).toHaveText(state().fingerprint);
  await p2.getByLabel('Identifiant').fill('caisse1');
  await p2.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
  await p2.getByRole('button', { name: 'Se connecter' }).click();
  await expect(p2.getByText(/Identifiant, mot de passe ou code incorrect/)).toBeVisible();
  await axe(p2, 'connexion');
  await shots(p2, 'ui-02-connexion');
  await p2.getByLabel('Mot de passe').fill(temp);
  await p2.getByRole('button', { name: 'Se connecter' }).click();
  await p2.getByLabel('Mot de passe actuel (temporaire)').fill(temp);
  await p2.getByLabel('Nouveau mot de passe').fill('Caisse-Akwa-2026!');
  await p2.getByRole('button', { name: 'Enregistrer' }).click();
  const nav = p2.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('link', { name: 'Caisse', exact: true })).toBeVisible();
  for (const hidden of ['Réception', 'Commandes', 'Inventaire', 'Rappels', 'Comptes', 'Système']) {
    await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  }
  await p2.goto('/comptes');
  await expect(p2.getByText('Accès refusé')).toBeVisible();
  await p2.keyboard.press('Control+k');
  await expect(p2.getByRole('dialog')).toBeVisible();
  await expect(p2.getByRole('option', { name: /Système/ })).toHaveCount(0);
  await other.close();
});
