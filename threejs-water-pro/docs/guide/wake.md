# Wake

Register a moving object — a boat, a buoy, a swimmer — and it leaves a wake on the water surface. Each generator stamps a disturbance along the path its object swept since the previous frame, and the wake field radiates and fades it with deep-water dispersion (long waves outrun short, giving the characteristic feathered, Kelvin-shaped wake). Wake foam appears automatically on breaking crests, shaded through the same pipeline as wind-driven foam.

See the [Wake API](/api/wake) for the full property and option reference.

## Basic Usage

Register any `Object3D` whose world motion should drive a wake. The system samples its position each frame, so the object just needs to move — you don't push velocities or positions yourself.

```typescript
// Register a boat. The returned id is used for later updates/removal.
const boatId = water.wake.addGenerator(boatMesh, {
  depth: 1.2, // How deep the hull sits — sets the wake amplitude
  radius: 4.0, // Footprint radius — sets the wake width
});

// Stop the wake (e.g. the boat left the scene).
water.wake.removeGenerator(boatId);
```

A generator only injects while its object moves **horizontally**. A stationary or purely bobbing object leaves no wake.

## Bow and Stern Generators

A single generator at the object's origin produces a usable wake, but a real hull throws a bow wave and drags a stern trail. Register two generators with `offset` to place them at the bow and stern; the field superposes them. The offset is a local-frame vector — `+Z` forward, `+X` right, `Y` ignored — and it rides the object's rotation, so a bow offset stays at the bow as the boat turns.

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

Anything omitted falls back to the default.

```typescript
water.wake.addGenerator(mesh, {
  active: true, // Start injecting immediately (false = registered but idle)
  depth: 1.2, // Hull depth in metres — the sole control of wake amplitude
  radius: 4.0, // Footprint radius in metres — sets the wake width
  offset: new THREE.Vector3(0, 0, 0), // Local-frame injection point (+Z fwd, +X right)
  teleportThreshold: 5.0, // Per-frame moves above this (m) are treated as a teleport
});
```

`teleportThreshold` guards against a respawn or camera cut being misread as a fast hull pass: when an object jumps farther than this in one frame, that frame injects nothing.

## Updating and Disabling

Change a generator at runtime with `updateGenerator` — omitted fields keep their current values:

```typescript
// Make the wake bigger while the boat is at full throttle.
water.wake.updateGenerator(boatId, { depth: 2.0, radius: 6.0 });

// Temporarily stop a generator (e.g. the boat is in dry dock).
water.wake.updateGenerator(boatId, { active: false });
```

You can also disable the whole system. Disabling clears the field, so the water reads calm rather than freezing the last wake:

```typescript
water.wake.enabled = false;
```

## Tuning the Field

The medium is shared by every generator — these are properties on `water.wake`, not per-generator options:

```typescript
water.wake.friction = 0.25; // Higher = shorter, more-damped trail
water.wake.foamStrength = 1.0; // Foam deposited by the hull track and breaking crests
water.wake.foamPersistence = 0.99; // Closer to 1 = longer-lasting foam trail
```

See the [Wake API](/api/wake#properties) for the full list and defaults.

## Backend and Quality

The wake solver runs as a WebGPU compute pass. On the WebGL backend the field stays calm (no wake) — registering generators is harmless there, it simply has no visible effect.

The field is quality-scaled: it runs at 256 / 512 / 1024 grid resolution on `medium` / `high` / `ultra`, and is disabled on `low`. You don't need to do anything for this — `WaterSystem` applies it when the quality level changes. The wake's world extent is centred on the camera's view, so it follows the player across an open ocean.

Up to 16 generators may inject in a single frame.
