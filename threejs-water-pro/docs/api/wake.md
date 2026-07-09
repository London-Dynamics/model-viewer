# Wake

Boat and buoy wakes on the water surface. Each registered object leaves a wake that spreads and fades behind it, with foam on the breaking crests. Runs on the WebGPU backend only (WebGL renders calm water) and is disabled at `low` quality.

Access via `water.wake`.

For the conceptual model and worked examples, see the [Wake guide](/guide/wake).

## Properties

Field-global parameters — one medium shared by every generator. All are plain getters/setters on `water.wake`. The foam and friction params (`foamBreakThreshold`, `foamPersistence`, `foamStrength`, `friction`) are also part of scene presets via the `wake` slice, so `loadPreset` sets them; `enabled`, `resolution`, and `worldSize` stay quality-tier-owned and are not preset-driven.

| Property            | Type      | Default | Description                                                                                     |
| ------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------- |
| `enabled`           | `boolean` | `true`  | Enable/disable the wake solve. `false` freezes the field flat at zero compute cost. Quality-scaled — disabled on `low`, on otherwise. |
| `foamBreakThreshold`| `number`  | `0.0`   | Surface steepness `\|∇h\|` at which wake foam begins to deposit.                                  |
| `foamPersistence`   | `number`  | `0.99`  | Per-frame wake-foam decay (closer to `1` = longer-lasting foam trail).                          |
| `foamStrength`      | `number`  | `1.0`   | Wake-foam injection rate from the hull track and breaking crests (sets the equilibrium foam energy). |
| `friction`          | `number`  | `0.25`  | Velocity-damping `γ` (≥ 0). Higher = shorter, more-damped trail. A moderate value is required for solver stability. |
| `resolution`        | `number`  | `256`–`1024` | Field grid resolution (texels per side); quality-scaled (256 / 512 / 1024 on medium / high / ultra). Changing it rebuilds the field. Demo exposes `256 / 512 / 1024`. |
| `worldSize`         | `number`  | `700`   | Field extent in world units per side, centred on the camera's view. Changing it rebuilds the field anchoring. |

## Methods

### `addGenerator`

```typescript
addGenerator(object: THREE.Object3D, options?: WakeGeneratorOptions): number
```

Register an object as a wake generator. Returns the generator ID (pass it to `updateGenerator` / `removeGenerator`).

| Parameter | Type | Description |
| --- | --- | --- |
| `object` | `THREE.Object3D` | The object whose horizontal motion drives the wake. |
| `options?` | `WakeGeneratorOptions` | Per-generator settings; omitted fields use defaults. See [Generator Options](#generator-options). |

### `removeGenerator`

```typescript
removeGenerator(id: number): boolean
```

Remove a generator by ID. Returns `true` if the generator was found.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `number` | The ID returned by `addGenerator`. |

### `updateGenerator`

```typescript
updateGenerator(id: number, options: WakeGeneratorOptions): boolean
```

Shallow-merge new options into a registered generator. Returns `true` if the generator was found.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `number` | The ID returned by `addGenerator`. |
| `options` | `WakeGeneratorOptions` | Fields to change; omitted fields keep their current values. |

### `getGeneratorCount`

```typescript
getGeneratorCount(): number
```

Get the number of registered generators.

### `getGenerators`

```typescript
getGenerators(): ReadonlyMap<number, WakeGenerator>
```

Get a read-only snapshot of the generator registry, keyed by ID.

Up to 16 generators may inject in a single frame.

### Generator Options

The `WakeGeneratorOptions` object passed to `addGenerator` / `updateGenerator`. Anything omitted falls back to the default.

| Option             | Type      | Default | Description                                                                                  |
| ------------------ | --------- | ------- | -------------------------------------------------------------------------------------------- |
| `active`           | `boolean`       | `true`    | Whether the generator starts active. Inactive generators stay registered but inject nothing. |
| `depth`            | `number`        | `1.2`     | How deep (metres) the hull sits in the water — the sole control of wake amplitude. Independent of hull speed. |
| `offset`           | `THREE.Vector3` | `(0,0,0)` | Local-frame offset (metres) from the object's origin to the injection point — `+Z` forward, `+X` right, `Y` ignored. It rides the object's rotation, so a bow offset stays at the bow as it turns. Register a second generator with a stern offset for a bow-plus-stern wake. |
| `radius`           | `number`        | `4.0`     | Footprint radius of the hull over the swept path, in metres (sets the wake width).           |
| `teleportThreshold`| `number`        | `5.0`     | Frame-to-frame world-position deltas above this (metres) are treated as a teleport — no injection that frame. |

A generator only injects when its object moves horizontally (in the XZ plane). A stationary or purely bobbing object injects nothing.

## Example

```typescript
import * as THREE from "three/webgpu";

// Register a boat with a deep, wide hull footprint at its centre.
const boatId = water.wake.addGenerator(boatMesh, { depth: 1.2, radius: 4.0 });

// For a richer wake, register a bow and a stern generator (forward = +Z here).
// The field superposes them into a bow wave plus a stern trail.
const bowId = water.wake.addGenerator(boatMesh, {
  depth: 1.2,
  radius: 4.0,
  offset: new THREE.Vector3(0, 0, 10), // 10 m forward of the origin
});
const sternId = water.wake.addGenerator(boatMesh, {
  depth: 1.2,
  radius: 4.0,
  offset: new THREE.Vector3(0, 0, -10), // 10 m aft
});

// Register a small buoy with a shallow, tight footprint.
const buoyId = water.wake.addGenerator(buoyMesh, { depth: 0.3, radius: 1.5 });

// Temporarily stop injection (e.g. while the boat is in dry dock).
water.wake.updateGenerator(boatId, { active: false });

// Tune the shared medium: more friction = a shorter, more-damped trail
// (does not change amplitude).
water.wake.friction = 0.5;

// Unregister.
water.wake.removeGenerator(boatId);
```
