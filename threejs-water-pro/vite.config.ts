import { defineConfig } from "vite";
import fs from "fs";
import { resolve } from "path";
import pkg from "./package.json";

function getHttpsConfig(): { key: Buffer; cert: Buffer } | undefined {
  try {
    return {
      key: fs.readFileSync("./demo/localhost+1-key.pem"),
      cert: fs.readFileSync("./demo/localhost+1.pem"),
    };
  } catch {
    return undefined;
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Demo app is in demo/ folder
  root: "demo",
  publicDir: "public",
  resolve: {
    alias: {
      // Resolve threejs-water-pro to source for faster development (no rebuild needed)
      "threejs-water-pro": resolve(__dirname, "src/index.ts"),
    },
  },
  server: {
    port: 3000,
    open: true,
    https: getHttpsConfig(),
    host: true,
  },
  preview: {
    // Don't auto-open browser for preview (used by benchmarks)
    open: false,
  },
  build: {
    target: "esnext",
    outDir: resolve(__dirname, "demo/dist"),
    minify: "terser",
    terserOptions: {
      compress: {
        passes: 2,
        drop_console: true,
        drop_debugger: true,
      },
      mangle: {
        properties: {
          // Mangle private properties (prefixed with _)
          regex: /^_/,
        },
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, "demo/index.html"),
      },
    },
  },
});
