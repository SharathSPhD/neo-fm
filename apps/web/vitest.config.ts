import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next compiles JSX with the automatic runtime; match it so components render in unit tests without importing React.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
  },
  resolve: {
    alias: {
      "server-only": new URL("./tests/mocks/server-only.ts", import.meta.url)
        .pathname,
      // Mirror the tsconfig `@/*` alias so imports inside route handlers
      // (`@/lib/supabase/server`, `@/components/...`) resolve under vitest.
      "@/": new URL("./", import.meta.url).pathname,
    },
  },
});
