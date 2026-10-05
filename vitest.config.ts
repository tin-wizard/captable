import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // order matters: the more specific alias must come first (tsconfig paths)
      "@/prisma": path.resolve(__dirname, "prisma"),
      "@": path.resolve(__dirname, "src"),
      // the real package throws outside a Next.js server runtime
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // one shared test database: do not run files in parallel
    fileParallelism: false,
  },
});
