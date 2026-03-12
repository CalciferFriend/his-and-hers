import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@his-and-hers/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
