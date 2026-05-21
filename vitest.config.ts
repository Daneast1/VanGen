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
    // Allow crypto/wasm libs a bit more time on cold start
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    // Array syntax is required to support the RegExp alias below.
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Some @noble/hashes deep subpath imports (e.g. "@noble/hashes/sha2.js")
      // are not resolvable in the jsdom test runtime. Collapse them to the
      // package root, which re-exports everything we need.
      {
        find: /^@noble\/hashes\/.*$/,
        replacement: "@noble/hashes",
      },
    ],
  },
});
