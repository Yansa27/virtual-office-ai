/**
 * ESLint flat config — Virtual Office.
 *
 * Frontend `public/**` adalah ES module browser (dimuat lewat
 * `<script type="module">`), backend `server.js`/`lib/*`/`test/*`
 * memakai CommonJS + global Node (node:test, fetch, dll).
 *
 * Config sengaja `.mjs` karena package root ber-`type: commonjs`.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'tmp/**',
      'home/**',
      'public/assets/**',
      'chat-workspaces/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Banyak blok `catch {}` yang disengaja (polling loop, best-effort).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Backend & test: CommonJS, bukan modul browser.
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
];