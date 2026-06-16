import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  // Ensure crypto libs are pre-bundled so Cloudflare Pages/Workers build
  // doesn't fail on dynamic ESM subpath imports.
  optimizeDeps: {
    include: [
      "@noble/curves/secp256k1.js",
      "@noble/hashes/sha2.js",
      "@noble/hashes/sha3.js",
      "@noble/hashes/legacy.js",
      "bs58",
      "bech32",
    ],
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          crypto: [
            "@noble/curves/secp256k1.js",
            "@noble/hashes/sha2.js",
            "@noble/hashes/sha3.js",
            "@noble/hashes/legacy.js",
          ],
        },
      },
    },
  },
}));
