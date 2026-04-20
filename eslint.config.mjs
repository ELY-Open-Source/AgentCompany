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
      "claude-code-source-reference/**",
      "pi-mono-reference/**",
      "boss-build/**",
      "local-release/**",
      "builtin-skills/**",
      "landing/**",
      "node_modules/**",
      "**/node_modules/**",
      ".next/**",
      "**/.next/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
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
      "@typescript-eslint/no-explicit-any": "warn",
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
  },
  {
    // C1 part 3/3 — block new top-level methods on AppDatabase.
    //
    // The whole point of the C1 codemod was to force callers through
    // the sub-module surface (`db.tasks.saveTask(...)`) rather than a
    // flat pass-through (`db.saveTask(...)`). Any new method added to
    // `AppDatabase` reintroduces exactly the broken-window pattern we
    // just killed. Allowed methods are limited to
    // `createHireRequest`, `rollbackConfigRevision`, and `queryAll`
    // (the documented multi-module composites + raw-SQL escape hatch).
    // Adding a new method here must either use a different name
    // (then the rule fires and you must justify it with a
    // disable-next-line and a rationale) or go on an existing or new
    // domain module.
    files: ["src/main/database.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ClassBody > MethodDefinition[key.name!=/^(createHireRequest|rollbackConfigRevision|queryAll)$/]",
          message:
            "C1: do not add new methods to AppDatabase. Put the implementation on the owning `database/<module>.ts` and invoke via `db.<module>.<method>(...)`. Only `createHireRequest`, `rollbackConfigRevision`, and `queryAll` are grandfathered; adding another requires a proposal and an explicit eslint-disable.",
        },
      ],
    },
  },
  {
    // B2 Phase 1 step 5/5 — block new raw status-writes on tasks.
    //
    // During dual-write every `UPDATE tasks SET status = ...` must go
    // through `advanceTaskPhase` (or the four grandfathered sites in
    // database-base.ts / database/tasks-*.ts / database/runs.ts that
    // already dual-write and carry `eslint-disable-next-line
    // no-restricted-syntax` with a comment explaining the exemption).
    // The no-restricted-syntax rule below intercepts string literals
    // and template literals whose text starts with the offending SQL
    // prefix. New code that needs to mutate `tasks.status` must either
    // route through `advanceTaskPhase` (preferred) or add an
    // `eslint-disable-next-line` with a rationale comment.
    //
    // Migrations are deliberately excluded — schema changes operate on
    // the legacy column by design.
    files: ["src/main/**/*.ts"],
    ignores: ["src/main/database/migrations/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Plain string literals and normal template heads.
          selector:
            "Literal[value=/\\b[Uu][Pp][Dd][Aa][Tt][Ee]\\s+tasks\\s+[Ss][Ee][Tt]\\s+status\\b/]",
          message:
            "B2 Phase 1: write task.status through advanceTaskPhase (or tag with `// eslint-disable-next-line no-restricted-syntax` + dual-write rationale for grandfathered sites).",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b[Uu][Pp][Dd][Aa][Tt][Ee]\\s+tasks\\s+[Ss][Ee][Tt]\\s+status\\b/]",
          message:
            "B2 Phase 1: write task.status through advanceTaskPhase (or tag with `// eslint-disable-next-line no-restricted-syntax` + dual-write rationale for grandfathered sites).",
        },
      ],
    },
  }
);
