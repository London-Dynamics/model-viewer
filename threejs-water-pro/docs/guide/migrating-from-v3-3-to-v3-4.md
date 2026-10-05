# Migrating from v3.3 to v3.4

v3.4 adds an optional physical water-color model. Existing v3.3 color configurations remain valid and keep their appearance.

For everything else included in this release, see the [v3.4.0 changelog](/changelog#v3-4-0-8-14-26).

## Keeping Your Existing Colors

No migration is required for an existing artist-authored color block:

```typescript
color: {
  waterColor: "#003366",
  absorptionColor: "#0a0503",
  transmissionColor: "#00ffcc",
}
```

A mode-less color block selects custom mode. These fields are the v3.4 custom-mode API, not a separate legacy schema, so no compatibility types or conversion layer are required. You may add `mode: "custom"` when you want the selection to be explicit.

Existing runtime assignments also remain unchanged:

```typescript
water.color.waterColor = "#124973";
water.color.absorptionColor = "#070302";
water.color.transmissionColor = "#00ffcc";
```

## Using Physical Water Colors

Physical mode derives absorption, scattering, and crest transmission from relative algae, silt, and stain amounts:

```typescript
color: {
  mode: "physical",
  algae: 0,
  silt: 0.19,
  stain: 0.01,
}
```

You can start from a built-in Jerlov water type and then adjust its constituent values:

```typescript
water.color.setJerlovType("Oceanic IB");
water.color.silt = 0.25;
```

The Jerlov names follow the standard clarity ordering, while their constituent values are representative Water Pro tuning seeds rather than official measured concentrations. See [Color & Transparency](/api/color#jerlov-water-types) for all ten names and values.

## Types and Persisted State

Use `WaterColorConfig` for either color mode. `WaterPreset`, `WaterPresetConfig`, and `WaterSceneConfig` are equivalent names for a complete v3.4 preset shape.

`normalizeWaterColorConfig()` checks a standalone color block and returns a fresh object with an explicit mode. `normalizeWaterSceneConfig()` clones a complete preset and normalizes its color block in the same way. Neither function accepts the abandoned shallow/deep gradient fields or scalar absorption input that appeared during v3.4 development.
