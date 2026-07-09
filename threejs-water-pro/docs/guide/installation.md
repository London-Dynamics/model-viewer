# Installation

## Running the Demo

After extracting the zip file, run the demo to see the library in action:

```bash
cd threejs-water-pro
npm install
npm run dev
```

This starts a development server with a full-featured ocean demo including adjustable parameters, floating objects, and underwater effects.

## Integrating into Your Project

### Option 1: ESM Module (Recommended)

The package comes with the library pre-built as an ESM module.

(Note: You can rebuild it by running `npm run build:lib`).

```
build/
├── index.js      ← Main library bundle
├── index.js.map  ← Source map for debugging
└── index.d.ts    ← TypeScript declarations
```

Copy the `build/` folder to your project

```
your-project/
├── lib/
│   └── threejs-water-pro/  ← Copy build/ contents here
├── package.json
└── ...
```

and import it

```typescript
import { WaterSystem } from "/lib/threejs-water-pro";
```

### Option 2: Copy Source Files

Copy the `src/` folder into your project for full source access:

```
your-project/
├── lib/
│   └── threejs-water-pro/    ← Copy src/ contents here
├── package.json
└── ...
```

Then import directly from that path:

```typescript
import { WaterSystem } from "/lib/threejs-water-pro";
```

This approach gives you full access to the source for debugging or customization.

### Option 3: Vite Alias

If you're using Vite, you can reference the library source directly without copying:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "threejs-water-pro": resolve(
        __dirname,
        "../threejs-water-pro/src/index.ts",
      ),
    },
  },
});
```

Then import as a package:

```typescript
import { WaterSystem } from "threejs-water-pro";
```

Adjust the path to wherever you extracted the threejs-water-pro folder.

## Requirements

### Three.js

Three.js Water Pro requires Three.js r181.0 or later:

```bash
npm install three@^0.181.0
```

::: warning ⚠️ WebGPU Build Required
You must import Three.js from `three/webgpu` and use `WebGPURenderer`:

```typescript
// Correct - import from three/webgpu
import * as THREE from "three/webgpu";

const renderer = new THREE.WebGPURenderer();
await renderer.init();

// Wrong - won't work with WebGPU features
import * as THREE from "three";
```

`WebGPURenderer` automatically falls back to WebGL if WebGPU is not available in the browser, so you don't need to handle renderer selection yourself.
:::

### Browser Support

WebGPU is required and available in:

- Chrome 113+ (recommended)
- Edge 113+
- Firefox Nightly (with flag)
- Safari 18+ (macOS Sequoia / iOS 18)

## Next Steps

- [Basic Example](/guide/basic-example) - Create your first ocean scene
- [Presets](/guide/presets) - Explore different ocean environments
