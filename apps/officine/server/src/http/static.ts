import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Interface web (build Vite) servie par le serveur, même origine (spec §8). Les fichiers sont chargés
 * en mémoire au démarrage depuis le seul répertoire du build : aucun chemin de la requête n'atteint
 * le disque (B-05 : sauvegardes, clés et base ne sont jamais servies). Les routes de l'application
 * renvoient index.html ; toute autre adresse reste 404.
 */

export const APP_ROUTES = [
  '/', '/caisse', '/produits', '/reception', '/commandes', '/inventaire', '/rappels', '/demandes', '/rapports',
  '/cloture', '/comptes', '/systeme', '/dossier',
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function collect(root: string, dir = root, out = new Map<string, { body: Buffer; type: string }>()) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(root, full, out);
    else {
      const type = TYPES[path.extname(name).toLowerCase()];
      if (type) out.set('/' + path.relative(root, full).split(path.sep).join('/'), { body: readFileSync(full), type });
    }
  }
  return out;
}

export function registerStatic(app: FastifyInstance, webDist: string | null): void {
  if (!webDist || !existsSync(path.join(webDist, 'index.html'))) return;
  const files = collect(webDist);
  const index = files.get('/index.html');
  if (!index) return;
  app.get('/*', (req, reply) => {
    const url = (req.url.split('?', 1)[0] ?? '/').replace(/\/+$/, '') || '/';
    const file = files.get(url);
    if (file) {
      const immutable = url.startsWith('/assets/');
      return reply.type(file.type).header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache').send(file.body);
    }
    if (APP_ROUTES.includes(url)) return reply.type(index.type).header('cache-control', 'no-cache').send(index.body);
    // UI-16 : un navigateur reçoit la page « introuvable » de l'application, toujours avec le statut 404.
    if (String(req.headers.accept ?? '').includes('text/html')) {
      return reply.status(404).type(index.type).header('cache-control', 'no-cache').send(index.body);
    }
    return reply.callNotFound();
  });
}
