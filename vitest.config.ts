import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgres://postflow@localhost:54329/postflow_test",
      SESSION_SECRET: "test-session-secret-test-session-secret-0123",
      TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      APP_TIMEZONE: "Asia/Kathmandu",
      FIREWORKS_API_KEY: "test-key",
      FIREWORKS_MODEL: "accounts/test/models/fake",
    },
  },
});
