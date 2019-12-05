module.exports = {
  env: {
    browser: true,
    es6: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier/@typescript-eslint', // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
      generators: false,
      experimentalObjectRestSpread: true,
    },
    project: './tsconfig.eslint.json',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-console': 'off', // Already caught by tslint
    'no-undef': 'off', // Currently does not work with typescript https://github.com/eslint/typescript-eslint-parser/issues/416
    'no-unused-vars': 'off', // Currently mistakes imported interfaces for unused variables

    '@typescript-eslint/array-type': 'off', // TODO ta bort?
    '@typescript-eslint/no-explicit-any': 'off', // TODO ta bort?
    '@typescript-eslint/explicit-function-return-type': 'off', // TODO ta bort?
    '@typescript-eslint/explicit-member-accessibility': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
      'vars': 'all',
      'args': 'none',
    }],
    '@typescript-eslint/camelcase': 'off', // There are a few exceptions, like variables from the backend and stuff
    '@typescript-eslint/no-unnecessary-type-assertion': ['error'],

    '@typescript-eslint/require-await': 'off', // currently buggy on 2019-11-20, see https://github.com/typescript-eslint/typescript-eslint/issues/1226

    '@typescript-eslint/no-unnecessary-condition': ['error', {
      'ignoreRhs': true,
    }],
    '@typescript-eslint/strict-boolean-expressions':['error', {
      'allowNullable': true,
      'ignoreRhs': true,
    }],

    // here startes the diff between frontend and backend

    '@typescript-eslint/no-empty-interface': 'off', // I use this sometimes in the frontend, to have some uniformity between components
  },
}