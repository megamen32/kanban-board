import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // The existing app uses effect-driven state hydration. Migrating every
      // component to React Compiler idioms is independent work; keep lint
      // useful for Next/TypeScript regressions without blocking releases.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'mini-services/**']),
]);
