import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/main.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // TDD §3/§4.2/§11: the simulation core and CCL runtime are pure, deterministic TS.
    // No Math.random, no browser globals, no `any`, and no imports from the UI layer.
    files: ['src/core/**/*.ts', 'src/ccl/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random is banned in core/ccl/content (TDD §4.2). Use the seeded PRNG owned by the sim.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No browser APIs in the sim layers (TDD §3).' },
        { name: 'document', message: 'No browser APIs in the sim layers (TDD §3).' },
        { name: 'localStorage', message: 'Storage is injected at startup (TDD §3).' },
        { name: 'requestAnimationFrame', message: 'The render loop lives in /ui (TDD §4.1).' },
        {
          name: 'setTimeout',
          message: 'No timers in the sim layers; time comes from tick() (TDD §3).',
        },
        {
          name: 'setInterval',
          message: 'No timers in the sim layers; time comes from tick() (TDD §3).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/*', '**/ui'], message: 'Nothing imports from /ui (TDD §3).' },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'No React in the sim layers (TDD §3).',
            },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // /content is plain data at the bottom of the graph: the dependency runs
    // core → content, so content may not reach back into /core or /ccl (TDD §3).
    files: ['src/content/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/*', '**/ui'], message: 'Nothing imports from /ui (TDD §3).' },
            {
              group: ['**/core/*', '**/core', '**/ccl/*', '**/ccl'],
              message: 'Dependency rule is core → content, not content → core/ccl (TDD §3).',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'No React in the sim layers (TDD §3).',
            },
          ],
        },
      ],
    },
  },
  {
    // /ccl is the lowest layer: it may not import from /core either (TDD §3: core → ccl).
    files: ['src/ccl/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/ui/*', '**/ui'], message: 'Nothing imports from /ui (TDD §3).' },
            {
              group: ['**/core/*', '**/core'],
              message: 'Dependency rule is core → ccl, not ccl → core (TDD §3).',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'No React in the sim layers (TDD §3).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
