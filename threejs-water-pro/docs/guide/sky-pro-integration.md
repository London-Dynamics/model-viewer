# Sky Pro Integration

A step-by-step guide to combining Three.js Water Pro with Three.js Sky Pro for an ocean scene under a fully procedural, animated sky. Sky Pro supplies the atmosphere, volumetric clouds, and sun; Water Pro reads all of it through a sky provider, so cloud reflections, sun glints, and water lighting follow the sky automatically.

This guide requires a licensed copy of each library. Choose the approach that best fits your project:

- **[TypeScript + Vite](#typescript-vite)** - Recommended for production apps with bundlers
- **[Plain JavaScript + CDN](#plain-javascript-cdn)** - Quick setup with no build tools

---

## TypeScript + Vite

### Step 1: Create a New Vite Project

```bash
npm create vite@latest my-ocean-project -- --template vanilla-ts
cd my-ocean-project
```

### Step 2: Install Three.js

```bash
npm install three@^0.185.0
npm install --save-dev @types/three@^0.185.0
```

### Step 3: Add the Libraries

1. Unzip `threejs-water-pro.zip` and `threejs-sky-pro.zip`.

2. In each unzipped package, install dependencies and build the library:

```bash
npm install
npm run build:lib
```

3. Create `threejs-water-pro` and `threejs-sky-pro` sub-directories within your `src` directory.

4. Copy the contents of each package's `build` directory into the matching directory you just created.

5. Your file structure should look something like this:

```
my-ocean-project/
├── src/
│   ├── threejs-water-pro/
│   │   ├── index.js      ← Water Pro library bundle
│   │   ├── index.js.map  ← Source map
│   │   └── index.d.ts    ← TypeScript declarations
│   ├── threejs-sky-pro/
│   │   ├── data/         ← Cloud noise data
│   │   ├── index.js      ← Sky Pro library bundle
│   │   ├── index.js.map  ← Source map
│   │   └── index.d.ts    ← TypeScript declarations
│   └── main.ts
├── index.html
└── package.json
```

### Step 4: Update index.html

Replace the contents of `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Three.js Water Pro + Sky Pro</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        overflow: hidden;
        background: #000;
      }
      canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### Step 5: Write the Main Code

Replace `src/main.ts` with:

```typescript
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WaterSystem, getPresetParams } from "./threejs-water-pro";
import { SkySystem, PRESETS } from "./threejs-sky-pro";

function setupPostProcessing(
  renderer: THREE.WebGPURenderer,
  water: WaterSystem,
  sky: SkySystem,
): THREE.PostProcessing {
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(water.scene, water.camera);
  let outputNode: THREE.Node = scenePass.getTextureNode("output");

  // Add water effects (atmospheric fog, underwater haze, sun shafts)
  outputNode = water.postProcessing.buildNode(scenePass, outputNode);

  // Composite the sky over the scene (distance fog, clouds, god rays).
  // It reads the scene pass depth, so clouds pass behind your geometry.
  outputNode = sky.applyTo(outputNode, scenePass);

  // Add bloom
  const bloomPass = bloom(outputNode, 0.5, 0.4, 0.85);
  outputNode = outputNode.add(bloomPass);

  postProcessing.outputNode = outputNode;
  return postProcessing;
}

async function main() {
  // Create renderer
  const renderer = new THREE.WebGPURenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  // Create scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    50000,
  );
  camera.position.set(50, 25, 50);

  // Add orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Create water system
  const water = await WaterSystem.create(renderer, scene, camera, "medium");
  water.loadPreset(getPresetParams("blackFlag"));

  // Create the sky. SkySystem.create adds its backdrop meshes to the scene
  // for you; applyPreset sets the look (clouds, atmosphere, sun).
  const sky = await SkySystem.create({ renderer, camera, scene, quality: "medium" });
  await sky.applyPreset(PRESETS.partlyCloudy);
  sky.sun.setFromAngles(35, 120);

  // Wire the sky into the water. The provider drives the water's sun
  // lighting, reflections, and fog color. `envMap: true` bakes an
  // environment map so reflections include the clouds.
  water.setSky(sky.createSkyProvider({ envMap: true }));

  // Set up post-processing
  const postProcessing = setupPostProcessing(renderer, water, sky);

  // Compile shaders before starting animation
  await renderer.compileAsync(scene, camera);

  // Animation loop
  let lastTime = performance.now();

  async function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    controls.update();
    sky.update(deltaTime);
    await water.update(deltaTime);
    postProcessing.render();
  }

  animate();
}

main();
```

::: tip Night sky
Sky Pro's star panorama is not bundled; without one, the sky renders black at night. This example keeps the sun up, so no starmap is needed. To animate a full day/night cycle, load an equirectangular starmap and pass it to `SkySystem.create` as `nightSky: { texture }`. See the Sky Pro documentation included with that package.
:::

### Step 6: Run the Project

```bash
npm run dev
```

Open your browser to the URL shown in the terminal (usually `http://localhost:5173`).

---

## Plain JavaScript + CDN

This approach uses import maps to load Three.js from a CDN, with no build tools required.

### Step 1: Create Project Files

Create a folder with the following structure:

```
my-ocean-project/
├── lib/
│   ├── threejs-water-pro/
│   └── threejs-sky-pro/
├── src/
│   └── main.js
└── index.html
```

### Step 2: Add the Libraries

1. Unzip `threejs-water-pro.zip` and `threejs-sky-pro.zip`.

2. In each unzipped package, install dependencies and build the library:

```bash
npm install
npm run build:lib
```

3. Copy each package's `build/index.js` into the matching `lib` sub-folder.

4. Copy Sky Pro's `build/data` directory into `lib/threejs-sky-pro/data`. Sky Pro loads its cloud noise data from this folder at runtime, resolved relative to `index.js`.

5. _Optional_: If you want source maps, also copy each `build/index.js.map`.

### Step 3: Create index.html

Both libraries use Three.js as a dependency. You will need to import Three.js via CDN using an import map.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Three.js Water Pro + Sky Pro</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        overflow: hidden;
        background: #000;
      }
      canvas {
        display: block;
      }
    </style>

    <!-- Import map for Three.js CDN -->
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.webgpu.min.js",
          "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.webgpu.min.js",
          "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.tsl.min.js",
          "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/"
        }
      }
    </script>
  </head>
  <body>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>
```

### Step 4: Create main.js

Use the same code as Step 5 of the TypeScript approach, with the imports and type annotations adjusted:

```javascript
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { WaterSystem, getPresetParams } from "../lib/threejs-water-pro/index.js";
import { SkySystem, PRESETS } from "../lib/threejs-sky-pro/index.js";

function setupPostProcessing(renderer, water, sky) {
  const postProcessing = new THREE.PostProcessing(renderer);
  const scenePass = pass(water.scene, water.camera);
  let outputNode = scenePass.getTextureNode("output");

  // Add water effects (atmospheric fog, underwater haze, sun shafts)
  outputNode = water.postProcessing.buildNode(scenePass, outputNode);

  // Composite the sky over the scene (distance fog, clouds, god rays).
  // It reads the scene pass depth, so clouds pass behind your geometry.
  outputNode = sky.applyTo(outputNode, scenePass);

  // Add bloom
  const bloomPass = bloom(outputNode, 0.5, 0.4, 0.85);
  outputNode = outputNode.add(bloomPass);

  postProcessing.outputNode = outputNode;
  return postProcessing;
}

async function main() {
  // Create renderer
  const renderer = new THREE.WebGPURenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  // Create scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    50000,
  );
  camera.position.set(50, 25, 50);

  // Add orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Create water system
  const water = await WaterSystem.create(renderer, scene, camera, "medium");
  water.loadPreset(getPresetParams("blackFlag"));

  // Create the sky. SkySystem.create adds its backdrop meshes to the scene
  // for you; applyPreset sets the look (clouds, atmosphere, sun).
  const sky = await SkySystem.create({ renderer, camera, scene, quality: "medium" });
  await sky.applyPreset(PRESETS.partlyCloudy);
  sky.sun.setFromAngles(35, 120);

  // Wire the sky into the water. The provider drives the water's sun
  // lighting, reflections, and fog color. `envMap: true` bakes an
  // environment map so reflections include the clouds.
  water.setSky(sky.createSkyProvider({ envMap: true }));

  // Set up post-processing
  const postProcessing = setupPostProcessing(renderer, water, sky);

  // Handle window resize
  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    water.resize();
    sky.resize(w, h);
  });

  // Compile shaders before starting animation
  await renderer.compileAsync(scene, camera);

  // Animation loop
  let lastTime = performance.now();

  async function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    controls.update();
    sky.update(deltaTime);
    await water.update(deltaTime);
    postProcessing.render();
  }

  animate();
}

main();
```

### Step 5: Serve the Files

You need a local web server since browsers block ES modules loaded via `file://`. Use any of these:

```bash
# Using Python
python3 -m http.server 8080

# Using Node.js (npx)
npx serve .

# Using PHP
php -S localhost:8080
```

Open `http://localhost:8080` in your browser.

---

## How the Integration Works

- **`water.setSky(sky.createSkyProvider({ envMap: true }))`**: The single wiring call. Sky Pro implements Water Pro's `SkyProvider` interface: the water reads the sky's environment map for reflections, samples the sky color for distance fog, and copies the sky's live sun (direction, color, intensity) into its own lighting every frame. Moving the sun, changing cloud coverage, or applying a sky preset propagates to the water on the next frame with no extra calls.
- **`envMap: true`**: Bakes an environment map behind the provider so water reflections include the clouds. Calling `createSkyProvider()` with no options uses a cheaper analytic sky-only reflection instead. Build the provider once and reuse it; each `createSkyProvider()` call disposes the previous one's baker.
- **Update order**: Call `sky.update(deltaTime)` before `water.update(deltaTime)` each frame, so the water samples the current frame's sky.
- **Post chain order**: Water effects first, then `sky.applyTo`, then bloom and tone mapping. Both nodes read the scene pass's depth, so fog, clouds, and god rays composite correctly against your geometry.

## Result

After running the app, you should see open ocean beneath a procedural sky, with the clouds mirrored in the water and the sun driving both the sky and the water lighting.

## Next Steps

- [Presets](/guide/presets) - Try different ocean environments
- [Custom Sky](/guide/custom-sky) - The built-in HDRI sky, if you are not using Sky Pro
- [WaterSystem API](/api/water-system) - Full API reference
