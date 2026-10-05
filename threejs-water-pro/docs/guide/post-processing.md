# Post-Processing

The water system includes built-in post-processing effects and integrates with Three.js's `PostProcessing` class, allowing you to layer your own effects on top.

## Built-in Effects

`water.postProcessing.buildNode(scenePass, inputColor)` bundles three effects into a single TSL node:

1. **Atmospheric Fog**: Distance-based fog that samples color from the sky. Configured via `water.fog`.
2. **Underwater Haze**: Per-pixel depth fog and animated distortion when the camera is submerged. Configured via `water.underwater`.
3. **Sun Shafts**: Screen-space god rays visible underwater. Configured via `water.sunShafts`.

These effects are applied in order and composed into a single output node. See [Atmospheric Fog](/api/fog), [Underwater](/api/underwater), and [Sun Shafts](/api/sun-shafts) for configuration details.

## Setting Up Post-Processing

The water system does not render post-processing on its own. You create a Three.js `PostProcessing` instance, call `water.postProcessing.buildNode()` to get a TSL node with water effects applied, and assign it (with any additional effects) to `postProcessing.outputNode`.

```typescript
import * as THREE from "three/webgpu";
import { pass } from "three/tsl";

const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(water.scene, water.camera);
let outputNode: THREE.Node = scenePass.getTextureNode("output");

// Apply water effects (atmospheric fog, underwater haze, sun shafts)
outputNode = water.postProcessing.buildNode(scenePass, outputNode);

postProcessing.outputNode = outputNode;
```

In your render loop, call `postProcessing.render()` instead of `renderer.render()`:

```typescript
async function animate() {
  requestAnimationFrame(animate);
  await water.update(deltaTime);
  postProcessing.render();
}
```

## Adding Your Own Effects

Since `water.postProcessing.buildNode()` returns a standard TSL node, you can chain additional effects after it:

```typescript
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";

const scenePass = pass(water.scene, water.camera);
let outputNode: THREE.Node = scenePass.getTextureNode("output");

// Water effects first
outputNode = water.postProcessing.buildNode(scenePass, outputNode);

// Anti-aliasing
outputNode = fxaa(outputNode);

// Bloom
const bloomPass = bloom(outputNode, 0.5, 0.4, 0.85);
outputNode = outputNode.add(bloomPass);

postProcessing.outputNode = outputNode;
```

### Recommended Effect Order

1. Water effects (`water.postProcessing.buildNode`)
2. Anti-aliasing (FXAA / SMAA)
3. Bloom
4. Film grain, vignette, or other screen-space effects

Water effects should come first because they rely on accurate depth buffer values. Anti-aliasing should follow to clean up edges introduced by the water surface and depth-based effects.

## Disabling Built-in Effects

To use the water system without any built-in post-processing, skip the `water.postProcessing.buildNode()` call entirely and render the scene directly.

Individual effects can be toggled at runtime:

```typescript
water.fog.enabled = false;
water.sunShafts.enabled = false;
water.underwater.enabled = false;
```

## Rebuilding After Quality Changes

When `setQualityLevel()` is called, the internal render pass textures are recreated. You must rebuild your post-processing pipeline afterwards:

```typescript
async function changeQuality(level: QualityLevel) {
  await water.setQualityLevel(level, params);

  // Recreate post-processing with new render pass textures
  postProcessing.outputNode = buildOutputNode(water);
}
```
