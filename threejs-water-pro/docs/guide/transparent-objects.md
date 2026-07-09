# Transparent Objects

The water system supports transparent objects using `MeshStandardMaterial` with `transparent: true` and `opacity < 1`. Fog (above and below water), reflections, and depth sorting are handled correctly for these objects.

```typescript
const material = new THREE.MeshStandardMaterial({
  color: 0x4488ff,
  transparent: true,
  opacity: 0.5,
});
```

## How It Works

The depth pass renders transparent objects in a separate sub-pass that captures both their depth (for fog calculations) and their premultiplied color with per-pixel coverage. Both the underwater fog and the above-water atmospheric fog use this to fog the transparent layer and the background behind it independently — each at its own distance — so a near transparent object is never washed over by the fog of the distant scene behind it, and the soft edges of a textured object don't leave a fog seam.

## Limitations

- **`MeshPhysicalMaterial` with `transmission` is not supported.** Physically-based transmission (glass, liquids) uses a separate rendering pipeline that is incompatible with the water system's depth pass. Use `MeshStandardMaterial` with `transparent: true` and `opacity` instead.
- **Alpha-tested materials** (`alphaTest > 0`) are rendered in the opaque depth pass, not the transparent pass. This is correct behavior for foliage and similar cutout materials.
