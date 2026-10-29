import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { browserClientsAllowed, setBrowserClientsAllowed } from '../../domain/devices.js';
import { getSettings, installedAt, regulSalesAllowed, SETTINGS, updateSettings, type SettingKey } from '../../domain/settings.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const Time = Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' });
const Fields = {
  pharmacy_name: Type.String({ maxLength: 120 }),
  pharmacy_address: Type.String({ maxLength: 200 }),
  pharmacy_phone: Type.String({ maxLength: 40 }),
  rx_policy: Type.Union([Type.Literal('all_medicines'), Type.Literal('flagged')]),
  allow_regul_sales: Type.Union([Type.Boolean(), Type.Null()]),
  discount_max_pct: Type.Integer({ minimum: 0, maximum: 100 }),
  prescription_max_age_days: Type.Integer({ minimum: 1, maximum: 3650 }),
  fraud_void_threshold: Type.Integer({ minimum: 1, maximum: 1000 }),
  opening_time: Time,
  closing_time: Time,
  backup_hour: Type.Integer({ minimum: 0, maximum: 23 }),
  backup_mirror_dir: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  allow_browser_clients: Type.Boolean(),
  cloud_sync_enabled: Type.Boolean(),
  cloud_url: Type.Union([Type.String({ maxLength: 200, pattern: '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' }), Type.Null()]),
  cloud_spki_sha256: Type.Union([Type.String({ pattern: '^[0-9a-f]{64}$' }), Type.Null()]),
};
const SettingsT = Obj({
  ...Fields,
  regul_sales_effective: Type.Boolean(),
  regul_sales_auto_until: NullableString,
  installed_at: NullableString,
});

function view(s: Services) {
  const regul = regulSalesAllowed(s);
  return {
    ...getSettings(s),
    allow_browser_clients: browserClientsAllowed(s),
    regul_sales_effective: regul.allowed,
    regul_sales_auto_until: regul.auto_until,
    installed_at: installedAt(s),
  };
}

/** Paramètres de l'officine (titulaire, ré-authentification : spec §6). */
export function settingsRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/settings', {
    config: { permission: 'settings.edit' },
    schema: { response: { 200: SettingsT } },
  }, async () => view(s));

  app.patch('/api/v1/settings', {
    config: { permission: 'settings.edit' },
    schema: { body: Type.Partial(Obj(Fields), { minProperties: 1 }), response: { 200: SettingsT } },
  }, async (req) => {
    const { allow_browser_clients, ...rest } = req.body as Record<string, unknown> & { allow_browser_clients?: boolean };
    const actor = actorOf(req);
    // W-11 : désactiver l'accès navigateur exige la preuve d'un poste appairé (domain/devices.ts).
    if (allow_browser_clients !== undefined) {
      const secret = req.headers['x-vp-device'];
      setBrowserClientsAllowed(s, actor, allow_browser_clients, typeof secret === 'string' ? secret : undefined);
    }
    const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => k in SETTINGS)) as Partial<Record<SettingKey, unknown>>;
    if (Object.keys(patch).length > 0) updateSettings(s, actor, patch);
    return view(s);
  });
}
