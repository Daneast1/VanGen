import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
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
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // FORCE any subpath specifier to look directly at the main entry point file
      "@noble/hashes/sha256": path.resolve(__dirname, "node_modules/@noble/hashes/esm/index.js"),
      "@noble/hashes/ripemd160": path.resolve(__dirname, "node_modules/@noble/hashes/esm/index.js"),
      "@noble/hashes/sha3": path.resolve(__dirname, "node_modules/@noble/hashes/esm/index.js"),
      "@noble/hashes/sha2": path.resolve(__dirname, "node_modules/@noble/hashes/esm/index.js"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core"
    ],
  },
}));
