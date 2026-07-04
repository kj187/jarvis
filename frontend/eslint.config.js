import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] },
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // AGENTS.md invariant #6: no console.log in production code
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // React-compiler-based rules: existing findings are tracked as adoption
      // backlog; keep them visible as warnings, escalate to error once clean.
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Playwright test code: not React (its `use` fixture parameter trips
    // rules-of-hooks), and `any` is acceptable when poking app internals.
    files: ['e2e/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      ...Object.fromEntries(
        Object.keys(reactHooks.rules).map((r) => [`react-hooks/${r}`, 'off']),
      ),
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
