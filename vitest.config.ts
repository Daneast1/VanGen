import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // FIXED: Changed from object syntax to array syntax to support the RegExp match wrapper
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        // Intercepts deep subpath requests during test executions
        find: /^@noble\/hashes\/(.*)$/,
        replacement: "@noble/hashes"
      }
    ],
  },
});
