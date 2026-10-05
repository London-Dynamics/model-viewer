# Wake

Register a moving object, such as a boat, buoy, or swimmer, and it leaves a wake on the water surface. Each generator stamps a disturbance along the path its object travelled since the previous frame. The wake field spreads and fades the disturbance with deep-water dispersion, producing the characteristic feathered, Kelvin-shaped wake. Wake foam appears automatically on breaking crests and is shaded through the same pipeline as wind-driven foam.

See the [Wake API](/api/wake) for the full property and option reference.

## Basic Usage

Register any `Object3D` whose world motion should drive a wake. The system samples the object's position each frame; you do not need to supply velocities or positions.

```typescript
// Register a boat. The returned id is used for later updates/removal.
const boatId = water.wake.addGenerator(boatMesh, {
  depth: 1.2, // Hull depth in metres. Controls the wake amplitude.
  radius: 4.0, // Footprint radius in metres. Controls the wake width.
});

// Stop the wake (e.g. the boat left the scene).
water.wake.removeGenerator(boatId);
```

A generator only injects while its object moves **horizontally**. A stationary or purely bobbing object leaves no wake.

## Bow and Stern Generators

A single generator at the object's origin produces a usable wake, but a real hull produces a bow wave and a stern trail. Register two generators with `offset` to place them at the bow and stern; the field superposes them. The offset is a local-frame vector (`+Z` forward, `+X` right, `Y` ignored) and follows the object's rotation, so a bow offset stays at the bow as the boat turns.

```typescript
import * as THREE from "three/webgpu";

// Bow: 10 m forward of the origin.
const bowId = water.wake.addGenerator(boatMesh, {
  depth: 1.2,
  radius: 4.0,
  offset: new THREE.Vector3(0, 0, 10),
});

// Stern: 10 m aft.
const sternId = water.wake.addGenerator(boatMesh, {
  depth: 1.2,
  radius: 4.0,
  offset: new THREE.Vector3(0, 0, -10),
});
```

A good starting point is to derive the offsets from the model's bounding box so they track the hull's actual length:

```typescript
const box = new THREE.Box3().setFromObject(boatMesh);
const halfLength = (box.max.z - box.min.z) / 2;

water.wake.addGenerator(boatMesh, {
  depth: 1.2,
  radius: 4.0,
  offset: new THREE.Vector3(0, 0, halfLength), // bow
});
```

## Generator Options

Omitted options fall back to their defaults.

```typescript
water.wake.addGenerator(mesh, {
  active: true, // Start injecting immediately. When false, the generator is registered but idle.
  depth: 1.2, // Hull depth in metres. The only control of wake amplitude.
  radius: 4.0, // Footprint radius in metres. Controls the wake width.
  offset: new THREE.Vector3(0, 0, 0), // Local-frame injection point (+Z forward, +X right).
  teleportThreshold: 5.0, // Moves larger than this in one frame (metres) are treated as a teleport.
});
```

`teleportThreshold` prevents a respawn or camera cut from being read as fast movement. When an object jumps farther than this in one frame, that frame injects nothing.

## Updating and Disabling

Change a generator at runtime with `updateGenerator`. Omitted fields keep their current values:

```typescript
// Make the wake bigger while the boat is at full throttle.
water.wake.updateGenerator(boatId, { depth: 2.0, radius: 6.0 });

// Temporarily stop a generator (e.g. the boat is in dry dock).
water.wake.updateGenerator(boatId, { active: false });
```

You can also disable the whole system. Disabling clears the field, so the water returns to calm instead of freezing the last wake:

```typescript
water.wake.enabled = false;
```

## Tuning the Field

The wake field is shared by every generator. These are properties on `water.wake`, not per-generator options:

```typescript
water.wake.friction = 0.25; // Higher values produce a shorter, more damped trail.
water.wake.foamStrength = 1.0; // Foam deposited by the hull track and breaking crests.
water.wake.foamPersistence = 0.99; // Values closer to 1 produce a longer-lasting foam trail.
```

See the [Wake API](/api/wake#properties) for the full list and defaults.

## Backend and Quality

The wake solver runs on both backends: a compute pass on WebGPU, or an equivalent render-to-texture pass on WebGL. Wakes look the same on either renderer.

The field scales with the quality level. It runs at 256, 512, or 1024 grid resolution on `medium`, `high`, and `ultra` respectively, and is disabled on `low`. `WaterSystem` applies this automatically when the quality level changes. The wake's world extent is centred on the camera's view, so it follows the player across an open ocean.

Up to 16 generators may inject in a single frame.
