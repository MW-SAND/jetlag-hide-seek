import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "**/public/**",
            "coverage/**",
            "playwright-report/**",
            "test-results/**",
        ],
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["apps/web/**/*.{ts,tsx}"],
        ...pluginReact.configs.flat.recommended,
        languageOptions: {
            ...pluginReact.configs.flat.recommended.languageOptions,
            globals: { ...globals.browser },
        },
        settings: { react: { version: "19" } },
    },
    {
        files: ["apps/web/**/*.{ts,tsx}"],
        plugins: { "react-hooks": pluginReactHooks },
        rules: {
            "react-hooks/rules-of-hooks": "error",
        },
    },
    {
        files: ["packages/**/*.ts"],
        languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    },
    {
        files: [
            "apps/server/**/*.ts",
            "e2e/**/*.{ts,mjs}",
            "scripts/**/*.{js,mjs,ts}",
            "apps/web/scripts/**/*.{js,mjs}",
            "*.{js,mjs,ts}",
            "apps/*/*.{js,mjs,ts}",
        ],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        plugins: { "simple-import-sort": simpleImportSort },
        rules: {
            "react/react-in-jsx-scope": "off",
            "react/prop-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
        },
    },
];
