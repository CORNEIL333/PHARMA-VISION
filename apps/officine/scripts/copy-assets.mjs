// Copie les fichiers non TypeScript (migrations SQL, liste de mots de passe) dans dist/.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/server/src/db/migrations', { recursive: true });
cpSync('server/src/db/migrations', 'dist/server/src/db/migrations', { recursive: true });
cpSync('server/src/security/common-passwords.txt', 'dist/server/src/security/common-passwords.txt');
