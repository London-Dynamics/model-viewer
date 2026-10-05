# Color & Transparency

Physical or artist-authored water color, plus the dielectric Fresnel that drives reflection / refraction mixing.

## `water.color`

Set `water.color.mode` to `"physical"` or `"custom"`. Both modes drive surface color, underwater attenuation, and wave-crest transmission.

### Physical mode

Physical mode derives water color from three relative constituent amounts.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"physical"` | `"physical"` | Selects physical mode. |
| `algae` | `number` | `0` | Relative phytoplankton amount; raises green relative to blue and red. |
| `silt` | `number` | `0.19` | Relative suspended-mineral amount; increases broad backscatter and turbidity. |
| `stain` | `number` | `0.01` | Relative colored dissolved organic matter; absorbs blue and shifts water toward brown. |

Use `setJerlovType()` to select physical mode and seed the constituent values, then adjust them if needed:

```typescript
water.color.setJerlovType("Oceanic IB");
water.color.silt = 0.25;
```

The built-in values are adjustable starting points rather than measured concentrations:

| Jerlov type | `algae` | `silt` | `stain` |
| --- | ---: | ---: | ---: |
| `Oceanic I` | 0 | 0.03 | 0 |
| `Oceanic IA` | 0 | 0.08 | 0 |
| `Oceanic IB` | 0 | 0.19 | 0.01 |
| `Oceanic II` | 0.08 | 0.3 | 0.03 |
| `Oceanic III` | 0.16 | 0.45 | 0.08 |
| `Coastal 1C` | 0.25 | 0.6 | 0.15 |
| `Coastal 3C` | 0.4 | 0.85 | 0.3 |
| `Coastal 5C` | 0.6 | 1.15 | 0.55 |
| `Coastal 7C` | 0.8 | 1.5 | 0.9 |
| `Coastal 9C` | 1.05 | 2 | 1.3 |

### Custom mode

Custom mode uses one intrinsic water color and per-channel Beer-Lambert absorption. Shallow water shows more of the refracted scene; deeper water approaches `waterColor`.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `"custom"` | — | Selects custom mode. |
| `waterColor` | `THREE.Color \| string` | `#003366` | Intrinsic water color approached with depth. |
| `absorptionColor` | `THREE.Color \| string` | `#0a0503` | Per-channel absorption coefficient encoded as a color. |
| `transmissionColor` | `THREE.Color \| string` | `#50a890` | Wave-crest transmission tint. |

Larger `absorptionColor` channel values absorb that channel sooner.

```typescript
water.color.update({
  mode: "custom",
  waterColor: "#006b8f",
  absorptionColor: "#a45b5b",
  transmissionColor: "#46fbf8",
});
```

Use `WaterColorConfig` for physical or custom configurations. `normalizeWaterColorConfig()` validates a configuration and returns a fresh object with an explicit mode.

## `water.fresnel`

Full dielectric Fresnel (Pharr et al., *PBR* §9.5.1) for the air–water interface. The same equation drives reflection / refraction mixing both above water and below (Snell's window and total internal reflection), so there is a single index-of-refraction parameter rather than separate above- and below-water curves.

| Property             | Type     | Default | Description                                                                                  |
| -------------------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `fadeEnd`            | `number` | auto    | Distance where the subsurface-scattering glow finishes fading out; the fade begins at half this distance. Auto-set to the water extent (outermost LOD edge) and reset on geometry changes; not normally tuned by hand. |
| `iorRatio`           | `number` | `1.33`  | Refractive index of water relative to air (physical seawater)                                |
| `refractionStrength` | `number` | `0.1`   | Screen-space refraction UV-offset strength. Drives the seabed wobble seen from above and the Snell's-window warp seen from below. |
