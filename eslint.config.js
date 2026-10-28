// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Code that must stay deterministic and environment-free (see docs/architecture.md). */
const PURE = [
  'src/core/**',
  'src/content/**',
  'src/sim/**',
  'src/save/format.ts',
  'src/save/save-manager.ts',
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Strings we spread (prefab rows, font text) are ASCII by contract.
      '@typescript-eslint/no-misused-spread': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: PURE,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'pixi.js/*'], message: 'The simulation must not depend on rendering.' },
            {
              group: ['**/client/**', '**/dev/**'],
              message: 'Pure layers must not import browser-side code.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the simulation Rng so runs are reproducible.' },
        { object: 'Date', property: 'now', message: 'The simulation counts ticks, not wall-clock time.' },
        {
          object: 'performance',
          property: 'now',
          message: 'The simulation counts ticks, not wall-clock time.',
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'fetch',
          'requestAnimationFrame',
        ].map((name) => ({ name, message: 'Pure layers must not touch the browser.' })),
      ],
    },
  },
  {
    files: ['scripts/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
