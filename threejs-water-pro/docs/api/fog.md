# Atmospheric Fog

Atmospheric fog is applied above water. Nearby geometry fades toward the fog `color`. At greater distances, the fog color blends toward the sky color so that the horizon has no visible seam. For underwater fog, see [Underwater](/api/underwater).

Access via `water.fog`.

## How It Applies

Fog is applied per material. The water system assigns a fog node to `scene.fogNode`, and the renderer evaluates it at the end of each material's shading, after lighting and before blending. Because each fragment is fogged at its own distance before blending, fog composes correctly with all transparency types: alpha-blended surfaces, sprites, alpha-tested cutouts, additive glows, and stacked billboards. Additive-blended materials fade out with distance instead of tinting toward the fog color.

Integration notes:

- Backdrop objects such as custom sky domes, cloud planes, and starfields should set `material.fog = false`. Otherwise they are fogged like ordinary geometry at their distance. The water system's own [Sky](/api/water-system) is excluded automatically.
- The fog node takes precedence over a classic `scene.fog`. The water system logs a warning if both are set.

## Properties

| Property           | Type                | Default     | Description                                                                      |
| ------------------ | ------------------- | ----------- | -------------------------------------------------------------------------------- |
| `color`            | `THREE.Color\|string` | `"#b4c0cc"` | Fog color at near distances. Distant fog blends from this color toward the sky color |
| `enabled`          | `boolean`           | `true`      | Enable/disable fog                                                               |
| `fadeEnd`          | `number`            | `1800.0`    | Distance where fog reaches full intensity                                        |
| `fadePower`        | `number`            | `1.0`       | Power curve for fog falloff (1 = linear, <1 faster, >1 slower)                   |
| `fadeStart`        | `number`            | `500.0`     | Distance where fog begins                                                        |
| `skyBlendDistance` | `number`            | `1500.0`    | Distance over which the fog color blends from `color` to the sky color           |

If `fadeStart` exceeds `fadeEnd`, the effective fade start is clamped to `fadeEnd`.

## Methods

The `create*` methods return TSL nodes bound to the live fog parameters. Preset loads and property changes propagate to your materials without a rebuild. Ordinary scene content does not need these methods, because the scene fog already applies to it. Use them for content the scene fog cannot reach, such as content composited after post-processing, or a material with `fog = false` that requires custom fog behavior. See [Transparent Objects](/guide/transparent-objects).

### `createFogColorNode`

```typescript
createFogColorNode(worldDirection: Node, distance: Node): Node
```

Returns the fog color at `distance` along `worldDirection`. Near the camera, the result is the fog `color`. Over `skyBlendDistance`, the result blends toward the sampled sky color, matching the scene fog. The node samples the sky texture once per call site. If no sky is set, the node returns the fog `color`, so call this method after `water.setSky(...)`.

| Parameter | Type | Description |
| --- | --- | --- |
| `worldDirection` | `Node` | World-space direction from the camera to the point (normalized internally). |
| `distance` | `Node` | Radial view distance in world units, camera → point. |

### `createFogFactorNode`

```typescript
createFogFactorNode(distance: Node): Node
```

Returns the fog opacity in `[0, 1]` at a radial view distance, using the same curve as the scene fog. The result is zero when `enabled` is `false`. The distance must be radial (`length(worldPos - cameraPos)`), not view-space depth. View-space depth produces fog that does not match the scene fog near the edges of the frame.

| Parameter | Type | Description |
| --- | --- | --- |
| `distance` | `Node` | Radial view distance in world units, camera → point. |

### `createFoggedColorNode`

```typescript
createFoggedColorNode(color: Node, options: FoggedColorOptions): Node
```

Returns the input color as seen through fog at a radial view distance. With `mode: "tint"` (the default), the color mixes toward the fog color. Use this mode for surfaces. With `mode: "fade"`, the color scales toward zero. Use this mode for additive light sources such as glows, flares, and tracers, which lose intensity with distance rather than taking on the fog color.

| Parameter | Type | Description |
| --- | --- | --- |
| `color` | `Node` | The unfogged color. |
| `options.distance` | `Node` | Radial view distance in world units, camera → point. |
| `options.mode` | `"fade" \| "tint"` | Fog mode. Defaults to `"tint"`. |
| `options.worldDirection` | `Node` | World-space direction from the camera to the point. |

### `update`

```typescript
update(params: FogParams): void
```

Sets all fog properties in a single call, typically from a preset.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `FogParams` | The fog values to apply: `color` (hex string), `enabled`, `fadeEnd`, `fadePower`, `fadeStart`, and `skyBlendDistance`. |

## Example

```typescript
water.fog.enabled = true;
water.fog.color = "#c8ccc0";
water.fog.fadeStart = 300;
water.fog.fadePower = 1.5;
// Blend the fog color toward the sky color over 2000 world units.
water.fog.skyBlendDistance = 2000;
```

```typescript
import { cameraPosition, color, length, positionWorld } from "three/tsl";

// Fog a billboard effect that is composited after post-processing,
// using the same curve as the scene fog.
const worldDelta = positionWorld.sub(cameraPosition);
material.colorNode = water.fog.createFoggedColorNode(color(0xffaa33), {
  distance: length(worldDelta),
  mode: "fade", // Use "tint" for surfaces.
  worldDirection: worldDelta,
});
```
