import type { Linter } from 'eslint';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        imports: 'readonly',
        globalThis: 'readonly',
        global: 'readonly',
      },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    plugins: {
      stylistic,
    },
    rules: {
      'stylistic/array-bracket-spacing': ['error', 'never'],
      'stylistic/block-spacing': ['error', 'always'],
      'stylistic/comma-spacing': ['error', { before: false, after: true }],
      'stylistic/comma-style': ['error', 'last'],
      'stylistic/indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['PropertyDefinition'] }],
      'stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'stylistic/keyword-spacing': ['error', { before: true, after: true }],
      'stylistic/no-multi-spaces': 'error',
      'stylistic/object-curly-spacing': ['error', 'always'],
      'stylistic/space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
      'stylistic/space-before-blocks': ['error', 'always'],
      'stylistic/space-in-parens': ['error', 'never'],
    },
  },
  {
    files: ['src/**/*.ts'],
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
] satisfies Linter.Config[];
