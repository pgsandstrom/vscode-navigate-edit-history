import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

import noOnlyTests from 'eslint-plugin-no-only-tests'
import { fixupPluginRules } from '@eslint/compat'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    // TODO someday I should make a simpler type-less linting for all config files
    ignores: ['webpack.config.js'],
  },
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'no-only-tests': fixupPluginRules(noOnlyTests),
    },
    rules: {
      // turn off unwanted rules:
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off', // this feels too verbose
      '@typescript-eslint/no-inferrable-types': 'off', // this brings very little value
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off', // complains when we have type unknown

      // these are turned off, but differs from other projects
      '@typescript-eslint/only-throw-error': 'off', // needlessly strict
      '@typescript-eslint/prefer-promise-reject-errors': 'off', // extension of 'only-throw-error' rule
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off', // this is just stylistic and unnecessary

      // activate extra rules:
      'no-only-tests/no-only-tests': 'error',
      eqeqeq: ['error', 'smart'],
      curly: ['error'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableBoolean: true,
        },
      ],
      '@typescript-eslint/prefer-enum-initializers': ['error'],
      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true, // disabled since it does not have a '--fix' option
        },
      ],

      // change config of activated rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        {
          // having this active is too verbose
          ignoreArrowShorthand: true,
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],

      // this rule would be awesome if it worked properly
      // re-evaluate when this issue has been settled:
      // https://github.com/typescript-eslint/typescript-eslint/issues/8113
      '@typescript-eslint/no-invalid-void-type': ['off'],
    },
  },
)
