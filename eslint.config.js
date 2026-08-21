// Flat config. `eslint-config-expo` carries the React Native and TypeScript
// rules; `eslint-config-prettier` switches off everything that would fight the
// formatter, so ESLint judges correctness and Prettier owns layout.
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = [
  ...expo,
  prettier,
  {
    ignores: ['**/dist/**', '**/dist-test/**', '**/.expo/**', 'node_modules/**'],
  },
  {
    // Build scripts and the core package run in Node, not on a phone.
    files: ['**/scripts/**', 'packages/core/**'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
];
