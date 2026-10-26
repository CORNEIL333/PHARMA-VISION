import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  changeSalePrice,
  createLocalItem,
  linkBarcode,
  lookupBarcode,
  productDetail,
  CATEGORIES,
  type LocalItemInput,
} from '../../domain/catalog.js';
import { importCatalog } from '../../domain/catalogImport.js';
import { searchProducts, type SearchOptions } from '../../domain/search.js';
import { AppError } from '../../errors.js';
import { grant } from '../../security/rbac.js';
import type { Services } from '../../services.js';
import { Obj, Uuid } from '../schemas.js';

/**
 * C-01 à C-06 et I-04 (annexe D). Toute route déclare sa permission ; le coût d'achat n'est
 * rendu qu'aux rôles qui ont `cost.view`. L'import reçoit le CSV brut (text/csv), jamais un chemin.
 */

const NullableStr = Type.Union([Type.String(), Type.Null()]);
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);

const ProductT = Type.Object({
  id: Type.String(),
  ref_code: NullableStr,
  name: Type.String(),
  dci: NullableStr,
  strength: NullableStr,
  form: NullableStr,
  presentation: NullableStr,
  category: Type.String(),
  rx_required: Type.Boolean(),
  sensitive: Type.Boolean(),
  criticity: Type.Integer(),
  storage: NullableStr,
  suggested_price: NullableInt,
  sale_price: NullableInt,
  min_qty: Type.Integer(),
  max_qty: Type.Integer(),
  status: Type.String(),
  activated_at: NullableStr,
  last_activity_at: NullableStr,
  local_only: Type.Boolean(),
});

const Gs1T = Type.Object({
  gtin: NullableStr,
  lot: NullableStr,
  expiry: NullableStr,
  serial: NullableStr,
});

const DetailT = Type.Composite([
  ProductT,
  Type.Object({
    barcodes: Type.Array(Type.Object({ code: Type.String(), kind: Type.String() })),
    lots: Type.Array(
      Type.Object({
        id: Type.String(),
        lot_number: Type.String(),
        expiry: NullableStr,
        qty: Type.Integer(),
        unit_cost: NullableInt,
      }),
    ),
  }),
]);

const ImportReportT = Type.Object({
  import_id: Type.String(),
  filename: NullableStr,
  sha256: Type.String(),
  lines_total: Type.Integer(),
  inserted: Type.Integer(),
  updated: Type.Integer(),
  rejected: Type.Integer(),
  unknown_columns: Type.Array(Type.String()),
  errors: Type.Array(
    Type.Object({ line: Type.Integer(), ref_code: NullableStr, reason: Type.String() }),
  ),
  conflicts: Type.Array(Type.Object({ line: Type.Integer(), code: Type.String(), product_id: Type.String() })),
  truncated: Type.Boolean(),
});

const CategoryT = Type.Union(CATEGORIES.map((c) => Type.Literal(c)));
const CodeT = Type.String({ minLength: 1, maxLength: 200 });
const IdParams = Obj({ id: Uuid });
const StatusT = Type.Union([Type.Literal('dormant'), Type.Literal('active'), Type.Literal('sleeping')]);

function actor(req: FastifyRequest): string {
  if (!req.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return req.auth.userId;
}

/** Nom de fichier fourni par le client : conservé pour le rapport, jamais utilisé comme chemin. */
function filenameOf(req: FastifyRequest): string | null {
  const raw = req.headers['x-filename'];
  if (typeof raw !== 'string' || !raw) return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/\p{Cc}/gu, '').slice(0, 120);
  return clean || null;
}

export function catalogRoutes(app: FastifyInstance, s: Services): void {
  app.get(
    '/api/v1/products',
    {
      config: { permission: 'session' },
      schema: {
        querystring: Obj({
          q: Type.Optional(Type.String({ maxLength: 200 })),
          status: Type.Optional(StatusT),
          cursor: Type.Optional(Type.String({ maxLength: 200 })),
          // Les valeurs d'URL sont des chaînes (coerceTypes est désactivé) : la conversion est faite ici.
          limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
        }),
        response: {
          200: Type.Object({ items: Type.Array(ProductT), next_cursor: NullableStr }),
        },
      },
    },
    async (req) => {
      const q = req.query as Omit<SearchOptions, 'limit'> & { limit?: string };
      return searchProducts(s, { ...q, limit: q.limit === undefined ? undefined : Number(q.limit) });
    },
  );

  app.get(
    '/api/v1/products/by-barcode/:code',
    {
      config: { permission: 'session' },
      schema: {
        params: Obj({ code: CodeT }),
        response: {
          200: Type.Object({
            found: Type.Boolean(),
            code: Type.String(),
            gs1: Type.Union([Gs1T, Type.Null()]),
            product: Type.Union([ProductT, Type.Null()]),
          }),
        },
      },
    },
    async (req) => lookupBarcode(s, (req.params as { code: string }).code),
  );

  app.get(
    '/api/v1/products/:id',
    {
      config: { permission: 'session' },
      schema: { params: IdParams, response: { 200: DetailT } },
    },
    async (req) => {
      const withCost = req.auth !== null && grant(req.auth.role, 'cost.view') === 'O';
      return productDetail(s, (req.params as { id: string }).id, withCost);
    },
  );

  app.post(
    '/api/v1/products/local',
    {
      config: { permission: 'catalog.link' },
      schema: {
        body: Obj({
          name: Type.String({ minLength: 1, maxLength: 200 }),
          category: CategoryT,
          barcode: Type.Optional(Type.String({ maxLength: 200 })),
          dci: Type.Optional(Type.String({ maxLength: 200 })),
          strength: Type.Optional(Type.String({ maxLength: 60 })),
          form: Type.Optional(Type.String({ maxLength: 60 })),
          presentation: Type.Optional(Type.String({ maxLength: 120 })),
          suggested_price: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
        }),
        response: { 201: ProductT },
      },
    },
    async (req, reply) => {
      const body = req.body as LocalItemInput;
      return reply.status(201).send(createLocalItem(s, actor(req), body));
    },
  );

  app.post(
    '/api/v1/products/:id/barcodes',
    {
      config: { permission: 'catalog.link' },
      schema: {
        params: IdParams,
        body: Obj({ code: CodeT }),
        response: { 200: Type.Object({ created: Type.Boolean(), product: ProductT }) },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { code } = req.body as { code: string };
      return linkBarcode(s, actor(req), id, code);
    },
  );

  app.patch(
    '/api/v1/products/:id/price',
    {
      config: { permission: 'price.edit' },
      schema: {
        params: IdParams,
        body: Obj({ sale_price: Type.Integer({ minimum: 0, maximum: 100_000_000 }) }),
        response: { 200: ProductT },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { sale_price } = req.body as { sale_price: number };
      return changeSalePrice(s, actor(req), id, sale_price);
    },
  );

  app.post(
    '/api/v1/catalog/import',
    {
      config: { permission: 'settings.edit' },
      schema: { response: { 200: ImportReportT } },
    },
    async (req) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError(
          'validation_failed',
          'Fichier attendu',
          'Le corps de la requête doit être un CSV (Content-Type: text/csv).',
        );
      }
      return importCatalog(s, actor(req), req.body, filenameOf(req));
    },
  );
}
