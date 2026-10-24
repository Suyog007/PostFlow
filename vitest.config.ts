import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same "@/..." imports as the app (tsconfig paths).
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postflow@localhost:54329/postflow_test",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      FIREWORKS_API_KEY: "test",
      FIREWORKS_MODEL: "test-model",
      // fixmyslop-ignore[sec/hardcoded-credential] test-only dummy value used by the local test run; not a real secret
      SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
      VITEST: "1",
    },
    fileParallelism: false,
    testTimeout: 30000,
  },
});
