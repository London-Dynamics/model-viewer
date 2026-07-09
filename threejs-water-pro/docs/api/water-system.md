# WaterSystem

The main entry point for the water rendering system. Manages all subsystems, rendering, and physics.

```typescript
import { WaterSystem } from "threejs-water-pro";
```

## `create()` {#create}

Static async factory method. The only way to instantiate a WaterSystem. Initializes with the "sunset" preset as default values.

```typescript
static async create(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quality?: QualityLevel,
  options?: WaterSystemOptions,
): Promise<WaterSystem>
```

| Parameter  | Type                      | Default  | Description                                                                                      |
| ---------- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `renderer` | `THREE.WebGPURenderer`    | —        | **(required)** Initialized WebGPU renderer                                                       |
| `scene`    | `THREE.Scene`             | —        | **(required)** Three.js scene to add water to                                                    |
| `camera`   | `THREE.PerspectiveCamera` | —        | **(required)** Camera for rendering                                                              |
| `quality`  | `QualityLevel`            | `"high"` | Quality tier: `"low"` `"medium"` `"high"` `"ultra"`. See [Quality Levels](/guide/quality-levels) |
| `options`  | `WaterSystemOptions`      | `{}`     | See [Options](#options) below                                                                    |

### Options {#options}

| Option          | Type       | Default | Description                                                                                                                                                                                                                                                                       |
| --------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deterministic` | `boolean`  | `false` | Enable fixed-step simulation. When `true`, `update()` accumulates the host's `deltaTime` and steps the simulation in `stepSize`-sized chunks; two clients at different host frame rates advance identically. When `false`, one host frame = one simulation step.                  |
| `seed`          | `number`   | `1`     | Phillips spectrum seed. Two clients with the same seed and parameters render the same waves on screen. Sampled heights are **not** bit-exact across GPU vendors — for multiplayer with buoyant objects, network the object state directly. See [multiplayer guide](#multiplayer). |
| `stepSize`      | `number`   | `1/60`  | Fixed simulation substep in seconds. Only used when `deterministic` is `true`.                                                                                                                                                                                                    |

## Properties {#properties}

### General

| Property            | Type                          | Access     | Description                                                                                                                          |
| ------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backend`           | `"webgpu" \| "webgl"`         | read-only  | Rendering backend                                                                                                                    |
| `camera`            | `THREE.PerspectiveCamera`     | read/write | Camera for rendering                                                                                                                 |
| `cameraTracking`    | `boolean`                     | read/write | Whether water grid follows camera (default: `true`)                                                                                  |
| `clipPlaneDistance` | `number`                      | read/write | Distance from camera to clip plane                                                                                                   |
| `config`            | `Readonly<WaterSystemConfig>` | read-only  | Quality and cascade settings                                                                                                         |
| `deterministic`     | `boolean`                     | read/write | Whether the simulation runs in fixed-step mode. Initialized from `create()`; flipping at runtime preserves absolute simulation time (the storage form is converted, not reset). Non-det → det snaps to the nearest tick. |
| `rendering`         | `RenderPassManager`           | read-only  | Advanced: scene depth, color, and mask render passes used by the water material and post-processing |
| `sampler`           | `IWaveSampler`                | read-only  | Wave height/normal sampler                                                                                                           |
| `scene`             | `THREE.Scene`                 | read-only  | The Three.js scene                                                                                                                   |
| `seed`              | `number`                      | read-only  | Phillips spectrum seed (set at `create()`). Two clients with the same seed see the same waves. See [multiplayer guide](#multiplayer). |
| `simulation`        | `IWaveSimulation`             | read-only  | FFT wave simulation backend. Cast to `WebGPUWaveSimulation` / `WebGLWaveSimulation` (per `backend`) for backend-specific access. |
| `simulationTime`    | `number`                      | read-only  | Simulation time in seconds. In deterministic mode this is exactly `tick * stepSize`; in non-deterministic mode it accumulates `deltaTime`. |
| `stepSize`          | `number`                      | read-only  | Fixed simulation substep in seconds (set at `create()`). Only used when `deterministic` is `true`.                                   |
| `tick`              | `number`                      | read-only  | Authoritative integer tick. Only defined in deterministic mode — throws otherwise. Override via {@link syncToTick}. See [multiplayer guide](#multiplayer). |
| `wireframe`         | `boolean`                     | read/write | Toggle wireframe rendering                                                                                                           |

### Surface

| Property           | Type                       | Description                                                                                                                                                    |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`            | `WaterColor`               | Body color and transparency. See [Color & Transparency](/api/color)                                                                                           |
| `foam`             | `FoamGroup`                | Surface, wave-crest, and shoreline foam. See [Foam](/api/foam)                                                                                                |
| `foamAccumulation` | `FoamAccumulation \| null` | Persistent wave-crest foam buffer and its runtime tuning (`crestStrength`, `decayTime`, `windwardStrength`). WebGPU only; `null` on WebGL. See [Foam](/api/foam) |
| `fresnel`          | `Fresnel`                  | Dielectric Fresnel mixing. See [Color & Transparency](/api/color)                                                                                             |
| `gerstner`         | `Gerstner`                 | Large-scale swell waves. See [Gerstner Waves](/api/gerstner)                                                                                                  |
| `sparkle`          | `Sparkle`                  | Sun glints. See [Sparkle](/api/sparkle)                                                                                                                       |
| `ssr`              | `SSR`                      | Screen-space reflections. See [Reflections](/api/ssr)                                                                                                         |
| `sss`              | `SSS`                      | Subsurface scattering. See [Subsurface Scattering](/api/sss)                                                                                                  |
| `waterline`        | `Waterline`                | Meniscus at the clip plane. See [Waterline](/api/waterline)                                                                                                   |
| `waves`            | `WaveUniforms`             | FFT wave simulation. See [Waves](/api/waves)                                                                                                                  |

### Underwater

| Property               | Type                   | Description                                                        |
| ---------------------- | ---------------------- | ------------------------------------------------------------------ |
| `floor`                | `OceanFloor`           | Ocean floor mesh and caustics. See [Ocean Floor](/api/ocean-floor) |
| `particles`            | `UnderwaterParticles`  | Ambient particles. See [Ambient Particles](/api/particles)         |
| `sunShafts`            | `SunShafts`            | God rays. See [Sun Shafts](/api/sun-shafts)                        |
| `underwater`           | `Underwater`           | Underwater fog. See [Underwater](/api/underwater)                  |
| `underwaterDistortion` | `UnderwaterDistortion` | Underwater UV distortion. See [Underwater](/api/underwater)        |

### Environment

| Property   | Type             | Description                                                                          |
| ---------- | ---------------- | ----------------------------------------------------------------------------------- |
| `fog`      | `AtmosphericFog` | Above-water atmospheric fog. See [Atmospheric Fog](/api/fog)                         |
| `lighting` | `Lighting`       | Sun uniforms, directional (shadow) light, and hemisphere ambient fill. See [Sun & Lighting](/api/sun) |

### Weather & Particles

| Property | Type                  | Description                                             |
| -------- | --------------------- | ------------------------------------------------------- |
| `rain`   | `RainSystem`          | Rain streaks and ripples. See [Rain](/api/rain)         |
| `spray`  | `SpraySystem \| null` | Wave-crest spray (WebGPU only). See [Spray](/api/spray) |
| `wake`   | `WakeSystem`          | Dispersive iWave displacement field for boat and buoy wakes (WebGPU). See [Wake](/api/wake) |

### Physics & Geometry

| Property   | Type             | Description                                            |
| ---------- | ---------------- | ------------------------------------------------------ |
| `buoyancy` | `BuoyancySystem` | Floating object physics. See [Buoyancy](/api/buoyancy) |
| `masking`  | `WaterMasking`   | Hide water inside objects. See [Masking](/api/masking) |

## Methods {#methods}

### Lifecycle

#### `create`

```typescript
create(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality?: QualityLevel, options?: WaterSystemOptions): Promise<WaterSystem>
```

Static async factory — the only way to construct a `WaterSystem`. See [`create()`](#create) above for the full parameter reference.

#### `update`

```typescript
update(deltaTime: number): Promise<void>
```

Advance the simulation. Call once per frame, before `render`.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Seconds elapsed since the last frame. |

#### `render`

```typescript
render(): void
```

Render the scene. Call after `update`.

#### `resize`

```typescript
resize(width?: number, height?: number): void
```

Handle a viewport resize.

| Parameter | Type | Description |
| --- | --- | --- |
| `width?` | `number` | New viewport width in pixels. Defaults to `window.innerWidth`. |
| `height?` | `number` | New viewport height in pixels. Defaults to `window.innerHeight`. |

#### `syncToTick`

```typescript
syncToTick(tick: number): void
```

Hard-snap the simulation to an absolute integer tick. Deterministic mode only. O(1); forward and backward snaps are both allowed. See [Multiplayer](#multiplayer).

| Parameter | Type | Description |
| --- | --- | --- |
| `tick` | `number` | The authoritative tick to snap to. Must be a finite integer. |

#### `dispose`

```typescript
dispose(): void
```

Release all GPU resources. Call when you're finished with the system.

```typescript
function animate() {
  water.update(clock.getDelta());
  water.render();
  requestAnimationFrame(animate);
}

// Cleanup
water.dispose();
```

::: warning
Always call `dispose()` when done to prevent memory leaks.
:::

### Quality

#### `setQualityLevel`

```typescript
setQualityLevel(quality: QualityLevel, params: WaterSceneParams): Promise<void>
```

Change the quality level at runtime. Internally disposes and recreates quality-dependent subsystems while preserving buoyancy registrations, mask objects, and sky.

| Parameter | Type | Description |
| --- | --- | --- |
| `quality` | `QualityLevel` | The new quality level. |
| `params` | `WaterSceneParams` | Current parameters to reapply after the rebuild. |

::: warning
This invalidates internal render pass textures. Rebuild your post-processing pipeline after calling this method. See [Post-Processing](/guide/post-processing#rebuilding-after-quality-changes).
:::

### Presets

#### `loadPreset`

```typescript
loadPreset(preset: PresetName | WaterPreset): void
```

Load a built-in preset name or a custom `WaterPreset` object. Updates all uniforms and subsystems. Does not affect the sky.

| Parameter | Type | Description |
| --- | --- | --- |
| `preset` | `PresetName \| WaterPreset` | A built-in preset name (e.g. `"sunset"`) or a custom `WaterPreset` object. |

```typescript
water.loadPreset("sunset");
water.loadPreset(myCustomPreset);
```

### Sky

#### `setSky`

```typescript
setSky(sky: Sky | null): void
```

Set a `Sky` instance for reflections and atmospheric fog, or pass `null` to disable them. The caller adds the sky's meshes to the scene.

| Parameter | Type | Description |
| --- | --- | --- |
| `sky` | `Sky \| null` | The sky to use, or `null` to disable sky reflections and fog. |

```typescript
import { Sky } from "threejs-water-pro";

const sky = new Sky({
  equirect: hdriTexture,
  sunDirection: water.lighting.sun.direction,
});
for (const mesh of sky.getMeshes()) scene.add(mesh);
water.setSky(sky);

water.setSky(null);
```

### Configuration

#### `getHeightAt`

```typescript
getHeightAt(x: number, z: number): Promise<number>
```

Query the water height at a world position.

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `number` | World-space X coordinate. |
| `z` | `number` | World-space Z coordinate. |

#### `setPosition`

```typescript
setPosition(x: number, z: number): void
```

Set the water grid center. Only takes effect when `cameraTracking` is off.

| Parameter | Type | Description |
| --- | --- | --- |
| `x` | `number` | World-space X coordinate of the grid center. |
| `z` | `number` | World-space Z coordinate of the grid center. |

#### `rebuildGeometry`

```typescript
rebuildGeometry(config: Partial<Omit<ClipmapConfig, "segments" | "infinityRingExtent">>): void
```

Rebuild the clipmap geometry with new LOD levels or base size.

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `Partial<Omit<ClipmapConfig, "segments" \| "infinityRingExtent">>` | Geometry fields to change (`levels`, `baseSize`); omitted fields are unchanged. Mesh resolution (`segments`) is owned by the active quality level — change it via `setQualityLevel` or the `QUALITY_LEVELS` entry, not here. |

#### `recreateOceanFloor`

```typescript
recreateOceanFloor(options: Partial<OceanFloorOptions>): Promise<void>
```

Recreate the ocean floor with new geometry or textures.

| Parameter | Type | Description |
| --- | --- | --- |
| `options` | `Partial<OceanFloorOptions>` | Ocean-floor fields to change; omitted fields are unchanged. See [OceanFloorOptions](/api/ocean-floor#options). |

#### `updateCascadeConfig`

```typescript
updateCascadeConfig(index: number, config: CascadeConfig): void
```

Update one FFT cascade's scale and amplitude.

| Parameter | Type | Description |
| --- | --- | --- |
| `index` | `number` | Zero-based cascade index. |
| `config` | `CascadeConfig` | Scale and amplitude for that cascade. |

#### `getGeometryConfig`

```typescript
getGeometryConfig(): Readonly<ClipmapConfig>
```

Get the current clipmap geometry configuration.

```typescript
water.rebuildGeometry({ levels: 5, baseSize: 600 });

await water.recreateOceanFloor({ meshResolution: 64 });

const height = await water.getHeightAt(100, 200);
```

### Post-Processing

Water post-processing lives on the `water.postProcessing` subsystem (a `PostProcessingPipeline`). Its `buildNode` method returns a TSL node that applies all water post-processing effects (atmospheric fog, underwater haze / distortion, sun shafts). Chain it into your post-processing pipeline.

#### `buildNode`

```typescript
buildNode(scenePass: PassNode, inputColor?: Node): Node
```

| Parameter | Type | Description |
| --- | --- | --- |
| `scenePass` | `PassNode` | The scene pass, from `pass(water.scene, water.camera)`. |
| `inputColor?` | `Node` | The color node to composite the water effects onto (typically the scene pass output). |

```typescript
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

const scenePass = pass(water.scene, water.camera);
let outputNode = scenePass.getTextureNode("output");

// Add water effects
outputNode = water.postProcessing.buildNode(scenePass, outputNode);

// Add your own effects
outputNode = bloom(outputNode);

postProcessing.outputNode = outputNode;
```

Returns the input node unchanged if underwater effects are disabled.

## Multiplayer / determinism {#multiplayer}

`WaterSystem` can be configured to produce the **same visible water surface on every client** given the same `(seed, params, stepSize, tick)`. This is opt-in via the `deterministic`, `seed`, and `stepSize` options on `create()`.

```typescript
const water = await WaterSystem.create(renderer, scene, camera, "high", {
  deterministic: true,
  seed: 12345,
});

// Whenever your network reports an authoritative tick:
water.syncToTick(authoritativeTick);
```

`syncToTick` is the entire sync mechanism. There is no separate "late join" path — the first call serves as the join, every subsequent call corrects accumulated drift. The call is O(1); it does not run catch-up substeps regardless of how far the target is from the current local tick. Forward and backward snaps are both allowed.

Any integer is accepted, including very large values derived from POSIX time (`~1e11` at 60 Hz). Internally, the library folds the absolute time modulo `8192` seconds (~2 h 17 m) before sending it to any GPU shader, so float32 wave-phase precision stays sub-millisecond regardless of input magnitude. Wave-component frequencies are snapped to multiples of `2π / 8192` rad/s so the wave field loops seamlessly across the fold — no visible artifact at the wrap. Two clients on the same tick fold identically and see the same wave field. The frequency snap perturbs each component by at most ~0.2% (typically much less); wavelengths are unchanged. See the [multiplayer guide](/guide/multiplayer#handling-tick-wraparound) for more.

What you get:

- **Same wave shape, same crest positions, same spray/wake** across clients with the same `seed` and parameters at the same `tick`.
- **Frame-rate-independent simulation** — `update()` drains an internal accumulator and steps in `stepSize`-sized chunks. A 30 Hz client and a 144 Hz client running for 1 second both step the simulation exactly 60 times (assuming default `stepSize: 1/60`).
- **Exact integer time.** `tick` is an integer, so two clients on the same tick are by definition at the same simulation frame — no floating-point drift inside a single client.

What you don't get:

- **Sampled heights are not bit-exact across GPUs.** The FFT runs on the GPU and float results differ between vendors by a few ULPs. For multiplayer with buoyant objects (boats, projectiles), **network the object state directly** — each client renders buoyancy on its own slightly-different water, but the network state is the truth. This is the standard pattern in networked physics games.
- **Foam visual agreement after a snap.** Foam buffers are ping-ponged history; they converge over a second or two after a `syncToTick` call. The first snap (at join) starts from empty foam and converges the same way.

`syncToTick(n)` throws if `n` is not a finite integer or if the system is not in deterministic mode. See the [multiplayer guide](/guide/multiplayer) for the full pattern, including how to compute `n` from a server tick or a shared wall-clock.
