import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "out/**",
      "**/out/**",
      "build/**",
      "dist/**",
      "oldreference/**",
      "Reference/**",
      "boss-build/**",
      "builtin-skills/**",
      "node_modules/**",
      "**/node_modules/**",
      ".next/**",
      "**/.next/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
      "local-release/**",
      "electron.vite.config.*.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "scripts/**/*.{ts,mjs}", "packages/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/incompatible-library": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  }
);
