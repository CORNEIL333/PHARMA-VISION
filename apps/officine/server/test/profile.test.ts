import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProfile, listPayers, profileStatus, saveSection, savePayer, validateSection } from '../src/domain/profile.js';
import { buildReceipt } from '../src/domain/receipt.js';
import { createAndLogin, makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { openRegister, sell, stockedProduct } from './sales.helpers.js';
import { payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

const FULL = {
  identite: { enseigne: 'Pharmacie du Centre', forme_juridique: 'entreprise_individuelle' },
  autorisation: { numero_autorisation: 'D-2019/0456/MINSANTE', date_autorisation: '2019-03-14', autorite: 'Ministre de la Santé publique' },
  titulaire: { nom: 'Dr Mballa', numero_onpc: 'ONPC-1234', telephone: '+237 699 11 22 33' },
  localisation: { region: 'Littoral', departement: 'Wouri', arrondissement: 'Douala Ier', ville: 'Douala', quartier: 'Akwa', repere: 'Face Hôtel de ville', district_sante: 'Deido', latitude: 4.05, longitude: 9.70 },
  contacts: { telephone: '233 42 11 00' },
  fiscal: { niu: 'm012345678901a', rccm: 'RC/DLA/2019/A/1234', regime: 'reel', centre_impots: 'CIME Douala', assujetti_tva: true },
  donnees: { responsable_nom: 'Dr Mballa', responsable_contact: 'contact@pharmacie.cm', dpo_designe: false },
  horaires: { jours: { lundi: { ouvert: true, ouverture: '07:30', fermeture: '21:00' } }, zone_garde: 'Douala Ier' },
  personnel: { membres: [{ nom: 'Dr Ngo', fonction: 'pharmacien_assistant', numero_onpc: 'ONPC-5678' }, { nom: 'Awa', fonction: 'caissier' }] },
};

describe('Dossier d’installation de l’officine', () => {
  it('rubriques validées, complétude calculée, journal sans données personnelles', () => {
    expect(profileStatus(t.s)).toMatchObject({ complete: false, done: 0, total: 9 });
    for (const [id, data] of Object.entries(FULL)) saveSection(t.s, tit.userId, id, data);
    expect(profileStatus(t.s)).toMatchObject({ complete: true, done: 9 });
    const fiscal = getProfile(t.s).find((x) => x.id === 'fiscal')!;
    expect(fiscal.data).toMatchObject({ niu: 'M012345678901A', rccm: 'RC/DLA/2019/A/1234' });
    const ev = payloadsOf(t.db, 'system.profile_updated').find((p) => p.section === 'titulaire')!;
    expect(ev.fields).toEqual(expect.arrayContaining(['nom', 'numero_onpc']));
    expect(JSON.stringify(payloadsOf(t.db, 'system.profile_updated'))).not.toContain('Mballa');
    const before = t.ledger.head();
    saveSection(t.s, tit.userId, 'contacts', FULL.contacts);
    expect(t.ledger.head()).toEqual(before);
  });

  it('refus explicites : champ obligatoire, région, téléphone, coordonnées hors Cameroun, pharmacien sans n° Ordre', () => {
    expect(() => validateSection('identite', { forme_juridique: 'sarl' })).toThrow(/enseigne : obligatoire/);
    expect(() => validateSection('localisation', { ...FULL.localisation, region: 'Lagos' })).toThrow(/region/);
    expect(() => validateSection('contacts', { telephone: '12345' })).toThrow(/camerounais/);
    expect(() => validateSection('localisation', { ...FULL.localisation, latitude: 48.85 })).toThrow(/latitude/);
    expect(() => validateSection('personnel', { membres: [{ nom: 'X', fonction: 'pharmacien_assistant' }] })).toThrow(/Ordre/);
    expect(() => validateSection('horaires', { jours: { lundi: { ouvert: true, ouverture: '21:00', fermeture: '07:00' } } })).toThrow(/fermeture/);
    expect(() => validateSection('identite', { ...FULL.identite, inconnu: 1 })).toThrow(/champ inconnu/);
  });

  it('le ticket reprend l’enseigne, l’adresse et les mentions NIU et RCCM', () => {
    for (const id of ['identite', 'localisation', 'contacts', 'fiscal'] as const) saveSection(t.s, tit.userId, id, FULL[id]);
    const p = stockedProduct(t, tit.userId);
    const sale = sell(t, tit.userId, openRegister(t, tit.userId), [{ product_id: p.productId, qty: 1 }], 1000);
    const r = buildReceipt(t.s, sale.id);
    for (const part of ['Pharmacie du Centre', 'Akwa, Face Hôtel de ville, Douala', 'NIU M012345678901A', 'RCCM RC/DLA/2019/A/1234']) {
      expect(r.text).toContain(part);
    }
  });

  it('HTTP : titulaire ré-authentifié seulement ; l’avancement est lisible par tous sans données', async () => {
    const pharm = await createAndLogin(t, tit, 'pharm', 'pharmacien');
    expect((await t.app.inject({ url: '/api/v1/profile/status', headers: H(pharm) })).json()).toMatchObject({ complete: false });
    expect((await t.app.inject({ url: '/api/v1/profile', headers: H(pharm) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'PUT', url: '/api/v1/profile/contacts', headers: H(pharm), payload: FULL.contacts })).statusCode).toBe(403);
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'PUT', url: '/api/v1/profile/contacts', headers: H(tit), payload: FULL.contacts })).json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    const ok = await t.app.inject({ method: 'PUT', url: '/api/v1/profile/contacts', headers: H(tit), payload: FULL.contacts });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'contacts', complete: true });
    expect((await t.app.inject({ method: 'PUT', url: '/api/v1/profile/inconnue', headers: H(tit), payload: {} })).statusCode).toBe(400);
  });

  it('organismes de tiers payant : création, nom unique, désactivation', () => {
    const a = savePayer(t.s, tit.userId, { name: 'Mutuelle des enseignants', kind: 'mutuelle', default_coverage_pct: 70 });
    expect(() => savePayer(t.s, tit.userId, { name: 'mutuelle des ENSEIGNANTS', kind: 'mutuelle' })).toThrow(expect.objectContaining({ title: 'Organisme déjà enregistré' }));
    expect(() => savePayer(t.s, tit.userId, { name: 'X', kind: 'assurance', default_coverage_pct: 120 })).toThrow();
    savePayer(t.s, tit.userId, { name: a.name, kind: 'mutuelle', active: false }, a.id);
    expect(listPayers(t.s, true)).toEqual([]);
    expect(payloadsOf(t.db, 'payer.created')).toHaveLength(1);
  });
});
