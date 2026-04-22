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
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: false }],
    },
  },
  {
    // Locale dictionaries are data tables generated as TypeScript
    // modules. The max-lines ceiling applies to executable source.
    files: ["src/renderer/i18n/*.ts"],
    rules: {
      "max-lines": "off",
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
    // C-01 — keep task state writes behind the database domain modules.
    //
    // `tasks.status` and the same-row runtime lock columns are the single
    // source of truth. Callers outside the database task/run modules must
    // use `db.tasks.*` / `db.runs.*` helpers instead of issuing ad hoc SQL.
    files: ["src/main/**/*.ts"],
    ignores: [
      "src/main/database/migrations/**/*.ts",
      "src/main/database/task-checkout.ts",
      "src/main/database-base.ts",
      "src/main/database/tasks-crud.ts",
      "src/main/database/tasks-status.ts",
      "src/main/database/tasks-update.ts",
      "src/main/database/runs.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Plain string literals: any `UPDATE tasks SET ...status = ...`
          // regardless of column ordering. The previous variant only
          // caught `SET status` as the first column, letting writes
          // like `SET checkout_run_id = ..., status = 'todo'` slip
          // through silently.
          selector:
            "Literal[value=/\\b[Uu][Pp][Dd][Aa][Tt][Ee]\\s+tasks\\s+[Ss][Ee][Tt]\\s[^;]*\\bstatus\\s*=/]",
          message:
            "C-01: write task.status through the database task/run helpers.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b[Uu][Pp][Dd][Aa][Tt][Ee]\\s+tasks\\s+[Ss][Ee][Tt]\\s[^;]*\\bstatus\\s*=/]",
          message:
            "C-01: write task.status through the database task/run helpers.",
        },
        {
          // Dynamic-SQL bypass: `UPDATE tasks SET ${...}` where the
          // first interpolation is a JS-built column list. The literal
          // head ends with `SET ` (trailing space) and `status` never
          // shows up in the template itself. Match the head-only shape
          // so dynamic task-state SQL stays inside the database task/run
          // modules instead of leaking to orchestration or renderer code.
          selector:
            "TemplateElement[value.raw=/\\b[Uu][Pp][Dd][Aa][Tt][Ee]\\s+tasks\\s+[Ss][Ee][Tt]\\s*$/]",
          message:
            "C-01: write task.status through the database task/run helpers.",
        },
      ],
    },
  }
);
