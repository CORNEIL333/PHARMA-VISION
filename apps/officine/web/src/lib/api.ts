/**
 * Client de l'API du serveur de l'officine (même origine). Ajoute le jeton CSRF sur toute écriture,
 * transforme les erreurs RFC 9457 en ApiError, signale la perte du serveur (bandeau hors ligne)
 * et rejoue une action après ré-authentification (A-07) quand l'utilisateur l'a confirmée.
 */

export interface Problem {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;
  constructor(p: Problem) {
    super(p.detail ?? p.title);
    this.status = p.status;
    this.code = p.code;
    this.problem = p;
  }
}

let csrf: string | null = null;
export const setCsrf = (v: string | null) => {
  csrf = v;
};

type Listener<T> = (v: T) => void;
function emitter<T>() {
  const ls = new Set<Listener<T>>();
  return {
    on: (l: Listener<T>) => {
      ls.add(l);
      return () => void ls.delete(l);
    },
    emit: (v: T) => ls.forEach((l) => l(v)),
  };
}

/** État de la connexion au serveur (bandeau « serveur injoignable »). */
export const connection = emitter<boolean>();
/** Session perdue (401 unauthenticated) : retour à l'écran de connexion. */
export const sessionLost = emitter<void>();

/** Fourni par la boîte de ré-authentification : résout vrai si l'utilisateur s'est ré-authentifié. */
let reauthHandler: ((purpose: string) => Promise<boolean>) | null = null;
export const setReauthHandler = (h: typeof reauthHandler) => {
  reauthHandler = h;
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Corps brut (CSV) avec son type. */
  raw?: { data: BodyInit; type: string; headers?: Record<string, string> };
  /** Réponse attendue en texte ou en binaire. */
  as?: 'json' | 'text' | 'blob';
  /** Ne pas proposer la ré-authentification automatiquement. */
  noReauth?: boolean;
}

function url(path: string, query?: RequestOptions['query']): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return `/api/v1${path}${s ? `?${s}` : ''}`;
}

async function send(path: string, o: RequestOptions): Promise<Response> {
  const method = o.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json, text/plain, */*' };
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  let body: BodyInit | undefined;
  if (o.raw) {
    headers['content-type'] = o.raw.type;
    Object.assign(headers, o.raw.headers ?? {});
    body = o.raw.data;
  } else if (o.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  try {
    const r = await fetch(url(path, o.query), { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
    connection.emit(true);
    return r;
  } catch {
    connection.emit(false);
    throw new ApiError({ title: 'Serveur injoignable', status: 0, code: 'offline', detail: 'Le serveur de l’officine ne répond pas.' });
  }
}

export async function api<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const r = await send(path, o);
  if (r.ok) {
    if (o.as === 'blob') return (await r.blob()) as T;
    if (o.as === 'text') return (await r.text()) as T;
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  }
  let p: Problem;
  try {
    p = (await r.json()) as Problem;
  } catch {
    p = { title: 'Erreur', status: r.status, code: r.status === 503 ? 'db_busy' : 'internal_error' };
  }
  if (p.code === 'reauth_required' && !o.noReauth && reauthHandler && (await reauthHandler(path))) {
    return api<T>(path, { ...o, noReauth: true });
  }
  if (p.code === 'unauthenticated') sessionLost.emit();
  throw new ApiError(p);
}

/** Message lisible pour l'utilisateur (jamais de détail technique). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.problem.detail && e.problem.detail !== e.problem.title ? `${e.problem.title} : ${e.problem.detail}` : e.problem.title;
  return 'Une erreur inattendue est survenue.';
}
