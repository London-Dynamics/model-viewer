# Transparent Objects

Transparent objects work with the water system without any special setup or registration. Above water, [atmospheric fog](/api/fog) is applied per material, inside each material's shader and before blending, so all transparency types compose correctly with fog:

- Alpha-blended surfaces (`transparent: true`, `opacity < 1`)
- Sprites (`THREE.Sprite`)
- Alpha-tested cutouts (`alphaTest > 0`)
- Additive-blended glows, flares, and trails, which fade out with distance instead of tinting toward the fog color
- Overlapping and stacked billboards, in any number

```typescript
const material = new THREE.MeshStandardMaterial({
  color: 0x4488ff,
  transparent: true,
  opacity: 0.5,
});
// Fog, reflections, and depth sorting are handled automatically.
```

## Underwater

Underwater fog is a post-processing effect. It uses a depth pre-pass that captures alpha-blended meshes in a single layer per pixel, which allows a near transparent object to be fogged separately from the water behind it. The capture has two limitations: sprites and alpha-tested materials are not captured, and only one transparent layer per pixel can be represented. Underwater fog on sprites, alpha-tested materials, and stacked transparents is therefore approximate. Above-water content is unaffected.

## Custom Fogging (Opt-Out)

To apply fog to content yourself, set `material.fog = false` on the material and use the [fog methods](/api/fog#methods), which expose the same curve and sky-blended color that the scene fog uses. This is useful for custom fog curves, for effects composited after post-processing, and for controlling how fog affects additive light:

```typescript
import { cameraPosition, color, length, positionWorld } from "three/tsl";

fxMaterial.fog = false; // The scene fog skips this material.
const worldDelta = positionWorld.sub(cameraPosition);
fxMaterial.colorNode = water.fog.createFoggedColorNode(color(0xffaa33), {
  distance: length(worldDelta),
  mode: "fade", // Use "tint" for surfaces.
  worldDirection: worldDelta,
});
```

Content composited after `postProcessing.buildNode(...)` is not processed by the underwater effects. If the camera can go below the surface, gate such content on `water.cameraSubmerged`.

## Verifying in the Demo

The demo includes a transparency test scene. **Debug → Show Transparency Test** places a labelled grid of transparency variants (alpha, sprite, additive, alpha-tested, stacked, depth-writing) in the scene, using stock three.js materials. Use the distance slider to move the grid through the fog and verify that every cell blends correctly and fades on the same curve as the water.

## Limitations

- **`MeshPhysicalMaterial` with `transmission` is not supported.** Physically-based transmission (glass, liquids) uses a separate rendering pipeline that is incompatible with the water system's depth pass. Use `MeshStandardMaterial` with `transparent: true` and `opacity` instead.
- **Backdrop meshes** (custom sky domes, cloud planes, starfields) should set `material.fog = false`. Otherwise they are fogged like ordinary geometry at their distance.
- **Underwater**, the transparent capture holds one alpha-blended mesh layer per pixel. Sprites, alpha-tested materials, and stacked transparents are not fully represented.
