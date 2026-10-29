import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data-local/**', 'web/**', 'desktop/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Utiliser crypto.randomBytes / randomInt (GUARDRAILS 11).',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Déstructuration pour retirer un champ d'une réponse : `const { secret: _s, ...rest } = row`.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server/src/domain/**/*.ts'],
    rules: { 'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Scripts Node en JavaScript (pas de TypeScript) : globales de Node déclarées explicitement.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly' } },
  },
);
