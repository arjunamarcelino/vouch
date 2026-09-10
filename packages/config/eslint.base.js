import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Shared ESLint flat config for the Vouch monorepo.
 *
 * Uses the (non type-checked) `recommended` preset for fast, robust linting
 * across a fresh scaffold. Type-aware linting (`recommendedTypeChecked` +
 * `parserOptions.projectService`) can be layered in per-package later — see
 * plan §17.7-12 — once every package's tsconfig is stable.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/generated/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/lib/**",
      "**/node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
