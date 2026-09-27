import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// React Router の Vite プラグインはテストでは不要なため、vite.config.ts とは別に定義する
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["app/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
  },
});
