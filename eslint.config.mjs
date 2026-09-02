import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Also match these nested inside git worktrees (e.g. .claude/worktrees/*/.next/**),
    // which the unanchored patterns above don't cover.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    // Vendored MediaPipe WASM runtime, copied verbatim from
    // @mediapipe/tasks-vision into public/models/ so it's self-hosted (see
    // src/lib/id-validation.ts) — generated third-party code, not ours to lint.
    "public/models/**",
  ]),
]);

export default eslintConfig;
