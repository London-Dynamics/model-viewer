# Floating Objects

Add buoyant objects that float on the water surface.

![Floating object example](../images/floating_objects.jpg)

## Basic Usage

```typescript
// Add a floating object with multi-point sampling (default)
// Uses bounding box for sample dimensions automatically
const boatId = water.buoyancy.addObject(boatMesh, {
  heightOffset: -1, // How deep it sits in water
  rotationInfluence: 0.7, // How much it tilts with waves (0-1)
});

// Remove later if needed
water.buoyancy.removeObject(boatId);
```

## Sampling Modes

The buoyancy system supports two sampling modes:

### Multi-Point Mode (Default)

Uses 5 sample points (center, bow, stern, port, starboard) for full pitch/roll dynamics. Best for ships and larger objects that should tilt with the waves.

```typescript
water.buoyancy.addObject(ship, {
  multiPoint: true, // Default, can be omitted
  heightOffset: -2,
  rotationInfluence: 0.5, // How much the object tilts
  heightSmoothing: 0.15, // Response time for bobbing
  rotationSmoothing: 0.2, // Response time for tilting
});
```

### Single-Point Mode

Uses 1 sample point at the object position. The object only bobs up and down - no rotation changes. Best for buoys, debris, or objects that should maintain their orientation.

```typescript
water.buoyancy.addObject(buoy, {
  multiPoint: false, // Single-point mode
  heightOffset: 0.5,
  heightSmoothing: 0.05,
});
```

## Configuration Options

```typescript
water.buoyancy.addObject(mesh, {
  // Core settings (both modes)
  heightOffset: 0, // Vertical offset (negative = deeper)
  heightSmoothing: 0.15, // Response time for bobbing (seconds)

  // Mode selection
  multiPoint: true, // true = 5-point sampling, false = 1-point

  // Multi-point configuration (only used when multiPoint: true)
  useBoundingBox: true, // Auto-calculate dimensions from geometry
  sampleLength: undefined, // Override auto length for pitch
  sampleWidth: undefined, // Override auto width for roll
  sampleOffset: new THREE.Vector3(), // Offset from object origin

  // Rotation (only used when multiPoint: true)
  rotationInfluence: 0.5, // Wave tilt matching (0 = stable, 1 = full tilt)
  rotationSmoothing: 0.2, // Response time for tilting (seconds)
});
```

## Automatic Bounding Box Sampling

When `multiPoint` is `true` and `useBoundingBox` is `true` (both defaults), the system automatically calculates `sampleLength` and `sampleWidth` from the object's bounding box:

```typescript
// Multi-point sampling with automatic dimensions
water.buoyancy.addObject(ship, {
  heightOffset: -2,
  rotationInfluence: 0.5,
});
```

## Overriding Sample Dimensions

You can override the auto-calculated dimensions when needed:

```typescript
water.buoyancy.addObject(ship, {
  heightOffset: -2,
  rotationInfluence: 0.5,
  useBoundingBox: false,
  sampleLength: 30, // Override: explicit bow/stern distance
  sampleWidth: 10, // Override: explicit port/starboard distance
});
```

## Update Configuration

You can toggle between modes at runtime:

```typescript
// Switch from multi-point to single-point
water.buoyancy.updateObjectConfig(boatId, {
  multiPoint: false,
});

// Update other properties
water.buoyancy.updateObjectConfig(boatId, {
  heightOffset: -0.5,
  rotationInfluence: 0.8,
});
```

## Shoreline Exclusion

Objects added to the buoyancy system are automatically excluded from shoreline effects (alpha fade and shoreline foam). This prevents the water from becoming transparent around boat hulls and buoys while keeping the effect active at actual terrain shorelines.

## Limits

- Maximum 128 sample points total
- Single-point objects: up to 128 objects
- Multi-point objects (5 samples each): up to 25 objects
- Mixed: e.g., 10 multi-point (50 samples) + 78 single-point (78 samples) = 128 total
