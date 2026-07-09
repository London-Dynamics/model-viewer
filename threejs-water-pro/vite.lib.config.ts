import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "esnext",
    outDir: "build",
    emptyOutDir: true,
    minify: "esbuild",
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      name: "ThreeJSWaterPro",
      formats: ["es"],
      fileName: (_, name) => `${name}.js`,
    },
    rollupOptions: {
      // Mark three.js and all its submodules as external (peer dependency)
      external: ["three", /^three\/.*/],
      output: {
        // Preserve module structure for better tree-shaking
        preserveModules: false,
        // Global variable name for UMD builds (not used for ESM-only)
        globals: {
          three: "THREE",
        },
      },
    },
    sourcemap: true,
  },
});
