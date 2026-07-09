# Color & Transparency

Physical Beer-Lambert water color, plus the dielectric Fresnel that drives reflection / refraction mixing.

## `water.color`

The depth-dependent appearance of the water falls out of the physics rather than from a shallow→deep color blend. At a fragment that views the seabed through `d` units of water:

```
transmitted = refractedScene · exp(−absorption · d)
            + waterColor    · (1 − exp(−absorption · d))
```

Where `absorption` is a `vec3` — per-channel extinction. This is what makes clear ocean turn blue-green with depth: red light absorbs much faster than blue, so as `d` grows, the seabed reading shifts toward `waterColor`.

| Property            | Type          | Default   | Description                                                                                                                                                                                       |
| ------------------- | ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absorptionColor`   | `THREE.Color` | `#0a0503` | Per-channel Beer-Lambert absorption coefficient (1/m), as a hex color. Each RGB byte is its own extinction rate — e.g. `#0a0503` ≈ R=0.04, G=0.02, B=0.01 per metre. Larger values = murkier water. |
| `transmissionColor` | `THREE.Color` | `#00ffcc` | Light transmission color (SSS)                                                                                                                                                                    |
| `waterColor`        | `THREE.Color` | `#003366` | Intrinsic water color — what the in-scattered radiance from the water column looks like, independent of what's behind it. Shallow water reads as seabed tinted toward this; deep water reads as this directly. |

Transparency is driven entirely by absorption: per-fragment surface alpha is `1 − (1 − F) · max(clearFactor.rgb)` on the front face, where `F` is the dielectric Fresnel reflectance and `clearFactor = exp(−absorptionColor · depth)`. Looking straight down at thin water, alpha drops toward `F` so the underwater scene shows through; at grazing or over deep water, alpha → 1. To get more translucent water everywhere, lower `absorptionColor`; to make it opaque sooner, raise it.

```typescript
water.color.waterColor = new THREE.Color("#124973");
// Clearer water: lower absorption per channel, blue passes farthest.
water.color.absorptionColor = new THREE.Color("#070302");
```

## `water.fresnel`

Full dielectric Fresnel (Pharr et al., *PBR* §9.5.1) for the air–water interface. The same equation drives reflection / refraction mixing both above water and below (Snell's window / TIR), so there is one IOR knob rather than separate above- and below-water curves.

| Property             | Type     | Default | Description                                                                                  |
| -------------------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `fadeEnd`            | `number` | auto    | Distance where Fresnel normal detail finishes fading. Auto-set to the water extent (outermost LOD edge) and reset on geometry changes — not normally tuned by hand. |
| `fadePower`          | `number` | `1.0`   | Distance fade power curve                                                                    |
| `fadeStart`          | `number` | `50.0`  | Distance where normal detail begins fade                                                     |
| `iorRatio`           | `number` | `1.33`  | Refractive index of water relative to air (physical seawater)                                |
| `normalStrength`     | `number` | `0.1`   | Normal perturbation strength (0–1)                                                           |
| `refractionStrength` | `number` | `0.1`   | Screen-space refraction UV-offset strength. Drives the seabed wobble seen from above and the Snell's-window warp seen from below. |
