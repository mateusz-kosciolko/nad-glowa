import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, globalIgnores, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    globals: {
      console: true,
      process: true,
      fetch: true,
      URL: true,
      URLSearchParams: true,
      setTimeout: true,
      setInterval: true,
      AbortSignal: true,
      Buffer: true,
      performance: true,
    },
  },
  rules: { "no-console": "off" },
});

// Klucz service_role omija RLS. Wartość polityk z alert_settings zależy od tego,
// że kod obsługujący żądania użytkownika nie ma jak po ten klient sięgnąć.
// Sam klucz i goły klient supabase-js są zablokowane osobno: inaczej dało się
// zbudować klienta service_role w dowolnej trasie z pominięciem supabase-admin.
const SERVICE_KEY_MESSAGE =
  "Klucz service_role omija RLS. Klienta z nim tworzy wyłącznie src/lib/supabase-admin.ts, a importuje go tylko handler scheduled (src/workers/scheduled.ts).";
const rawServiceKeyPaths = [
  { name: "astro:env/server", importNames: ["SUPABASE_SERVICE_KEY"], message: SERVICE_KEY_MESSAGE },
  { name: "@supabase/supabase-js", importNames: ["createClient"], message: SERVICE_KEY_MESSAGE },
];

const serviceKeyBoundary = defineConfig({
  files: ["src/**/*.{ts,tsx,astro}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: rawServiceKeyPaths,
        patterns: [
          {
            // `.*` catches `supabase-admin.ts` / `.js` specifiers, which also resolve.
            group: ["**/supabase-admin", "**/supabase-admin.*", "@/lib/supabase-admin", "@/lib/supabase-admin.*"],
            message: SERVICE_KEY_MESSAGE,
          },
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      { selector: "ImportExpression[source.value=/supabase-admin/]", message: SERVICE_KEY_MESSAGE },
    ],
  },
});

// The scheduled handler may import supabase-admin, but not build its own service_role client.
const schedulerConfig = defineConfig({
  files: ["src/workers/scheduled.ts"],
  rules: { "no-restricted-imports": ["error", { paths: rawServiceKeyPaths }], "no-restricted-syntax": "off" },
});

const adminClientConfig = defineConfig({
  files: ["src/lib/supabase-admin.ts"],
  rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" },
});

// Poza src/ klucz service_role wolno czytać wyłącznie w scripts/smoke.mjs (lokalna Supabase, Admin API).
const SCRIPT_SERVICE_KEY_MESSAGE =
  "Klucz service_role omija RLS. W scripts/ czyta go wyłącznie scripts/smoke.mjs (lokalna Supabase przez Admin API).";
const scriptsServiceKeyBoundary = defineConfig({
  files: ["scripts/**/*.mjs"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_KEY']",
        message: SCRIPT_SERVICE_KEY_MESSAGE,
      },
      {
        selector:
          "MemberExpression[object.object.name='process'][object.property.name='env'][property.value='SUPABASE_SERVICE_KEY']",
        message: SCRIPT_SERVICE_KEY_MESSAGE,
      },
      {
        selector:
          "VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern > Property[key.name='SUPABASE_SERVICE_KEY']",
        message: SCRIPT_SERVICE_KEY_MESSAGE,
      },
    ],
  },
});

const smokeConfig = defineConfig({
  files: ["scripts/smoke.mjs"],
  rules: { "no-restricted-syntax": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // .claude/: owned by @przeprogramowani/10x-cli and hash-checked; --fix would break `10x get` updates.
  // database.types.ts: generated by `npm run db:types`; worker-configuration.d.ts: by `npm run cf:types`.
  // Regenerate instead of editing.
  globalIgnores([".claude/", "src/db/database.types.ts", "worker-configuration.d.ts"]),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  scriptsServiceKeyBoundary,
  smokeConfig,
  serviceKeyBoundary,
  schedulerConfig,
  adminClientConfig,
  eslintPluginPrettier,
);
