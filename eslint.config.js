import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'vitest.config.ts',
            'tests/setup.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslintConfigPrettier,
);
