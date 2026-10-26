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
    },
  },
  {
    files: ['server/src/domain/**/*.ts'],
    rules: { 'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }] },
  },
);
