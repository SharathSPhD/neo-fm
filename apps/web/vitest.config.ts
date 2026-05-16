import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
