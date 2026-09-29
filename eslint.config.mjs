import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const restrict = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
  // Architecture boundaries (see docs/architecture.md).
  {
    // Domain logic is pure: no database, framework or server imports.
    files: ["src/domain/**"],
    rules: restrict([
      {
        group: ["@/server/*", "next", "next/*", "react", "pg", "drizzle-orm", "drizzle-orm/*"],
        message: "src/domain must stay pure.",
      },
    ]),
  },
  {
    // UI reads via src/server/queries and writes via src/server/commands only.
    files: ["src/app/**"],
    rules: restrict([
      {
        group: ["@/server/db", "@/server/db/*"],
        message: "UI must not touch the database directly; use queries/commands.",
      },
    ]),
  },
  {
    // AI (future) is advisory: it may never write authoritative data.
    files: ["src/ai/**"],
    rules: restrict([
      {
        group: ["@/server/db", "@/server/db/*", "@/server/commands", "@/server/commands/*"],
        message: "AI code must not write authoritative data; persist suggestions via the AI suggestion store only.",
      },
    ]),
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
