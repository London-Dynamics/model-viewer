# Spray

`SpraySystem` emits particle plumes when probes attached to an object cross the water surface. Access it via `water.spray`, which is `null` on the WebGL backend.

For the conceptual model, override precedence, and worked examples, see the [Spray guide](/guide/spray).

## `water.spray`

### Methods

#### `addEmitter`

```typescript
addEmitter(object: THREE.Object3D, options: AddEmitterOptions): number
```

Register an object as a spray source. Returns an emitter id, or `-1` if the emitter cap is reached or the system is unallocated (Low and Medium quality).

| Parameter | Type | Description |
| --- | --- | --- |
| `object` | `THREE.Object3D` | The object the probes are attached to; its transform drives them. |
| `options` | `AddEmitterOptions` | Emitter configuration. `options.probes` is required. See [AddEmitterOptions](#addemitteroptions). |

#### `updateEmitter`

```typescript
updateEmitter(id: number, options: Partial<AddEmitterOptions>): boolean
```

Update one emitter's parameters (`active` plus any per-emitter parameter). The probe set is fixed at registration; remove and re-add the emitter to change probes. Returns `true` if the emitter was found.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `number` | The emitter id returned by `addEmitter`. |
| `options` | `Partial<AddEmitterOptions>` | Fields to change; any `probes` entry is ignored. |

#### `removeEmitter`

```typescript
removeEmitter(id: number): boolean
```

Remove a previously registered emitter. Returns `true` if the emitter was found.

| Parameter | Type | Description |
| --- | --- | --- |
| `id` | `number` | The emitter id returned by `addEmitter`. |

#### `setProbeEnabled`

```typescript
setProbeEnabled(emitterId: number, probeIndex: number, enabled: boolean): boolean
```

Toggle a single probe on or off at runtime. Returns `true` if the probe was found.

| Parameter | Type | Description |
| --- | --- | --- |
| `emitterId` | `number` | The emitter id returned by `addEmitter`. |
| `probeIndex` | `number` | Index of the probe within that emitter's `probes` array. |
| `enabled` | `boolean` | `true` to enable, `false` to disable. The probe keeps its slot. |

#### `getProbeDebugData`

```typescript
getProbeDebugData(): ProbeDebugSnapshot[]
```

Snapshot every probe's current world position, velocity, and approximate lifecycle state. Pass the result to `SprayDebugVisualizer`.

#### `dispose`

```typescript
dispose(): void
```

Release GPU resources.

### `SprayProbe`

A single emission point. Extends `Partial<EmitterParams>`; any per-emitter parameter may be supplied as a per-probe override.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Enable/disable this probe. |
| `local` | `Vector3` | — | Probe position in object-local space (m). Required. |
| `<EmitterParams>` | varies | inherits | Any field from the per-emitter params table below, used as a per-probe override. |

### `AddEmitterOptions`

Extends `Partial<EmitterParams>`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `active` | `boolean` | `true` | Whether the emitter is active. |
| `probes` | `SprayProbe[]` | — | Required. |

### Properties

`enabled` and `maxCount` are system-wide. The remaining properties are per-probe; every probe holds its own resolved copy. Setters update the system default and propagate to probes that did not set their own value for that key.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `bottomFadeStart` | `number` | `0.0` | Bottom-fade start (0–1, billboard-vertical). Alpha is fully transparent at and below this height. |
| `bottomFadeStop` | `number` | `0.15` | Bottom-fade stop (0–1, billboard-vertical). Alpha is fully opaque at and above this height. Set both fade values to `0` to disable. |
| `duration` | `number` | `1.5` | Maximum particle lifetime (s). |
| `enabled` | `boolean` | `true` | Enable/disable spray (system-wide). When `false`, both compute dispatches are skipped. The bundled presets enable spray, so the flag is `true` after creation at every quality level; spray only renders at High and Ultra, where the particle pool is allocated. |
| `fadeOutTime` | `number` | `0.5` | Length of the alpha fade-out tail (s), measured backwards from death. `0` cuts the plume off instantly when life expires. |
| `maxCount` | `number` | — | Read-only. Total particle pool size = `MAX_EMITTERS × MAX_PROBES_PER_EMITTER`. |
| `opacity` | `number` | `0.4` | Master opacity multiplier (0–1). |
| `respawnTime` | `number` | `1.0` | Extra cooldown (s) after a plume dies before the same probe can fire again. |
| `size` | `number` | `27.5` | Base billboard side length (m). |
| `spawnJitterTime` | `number` | `0.0` | Maximum random delay (s) between trigger and visible spawn. `0` disables. |
| `stretchX` | `number` | `1.88` | Width multiplier (perpendicular to up). |
| `stretchY` | `number` | `1.0` | Height multiplier (along up). |
| `submersionDepth` | `number` | `0.5` | Distance (m) below the displaced water surface to anchor the billboard bottom. |
| `velocityHeightFactor` | `number` | `0.0` | Per-particle height scale as a function of impact speed at fire (frozen at spawn). Capped at 2×. `0` disables. |
| `velocityScaleFactor` | `number` | `0.0` | Per-particle uniform scale as a function of impact speed at fire (frozen at spawn). Capped at 2×. `0` disables. |
| `velocityThreshold` | `number` | `3.9` | Minimum impact speed (m/s) for a probe to fire. |

## Example

```typescript
// Fire spray plumes from a boat's bow and stern as they cross the surface.
const emitterId = water.spray?.addEmitter(boatMesh, {
  probes: [
    { local: new THREE.Vector3(0, 0, 6) }, // bow
    { local: new THREE.Vector3(0, 0, -6) }, // stern
  ],
});

// Update the system default. It propagates to probes that did not set their own value.
if (water.spray) water.spray.velocityThreshold = 2.5;
```

## SprayDebugVisualizer

Renders each probe as a wireframe sphere with a velocity arrow. Owned by the application, not the water system.

```typescript
import { SprayDebugVisualizer } from "threejs-water-pro";

const vis = new SprayDebugVisualizer(scene);
vis.setEnabled(true);

if (vis.isEnabled() && water.spray) {
  vis.update(water.spray.getProbeDebugData());
}
```

### Methods

#### `setEnabled`

```typescript
setEnabled(enabled: boolean): void
```

Show or hide the visualization.

| Parameter | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | `true` to show the probe spheres and arrows, `false` to hide them. |

#### `isEnabled`

```typescript
isEnabled(): boolean
```

Whether the visualization is currently active.

#### `update`

```typescript
update(snapshots: ProbeDebugSnapshot[]): void
```

Refresh the visualization from a snapshot. Call once per frame while enabled.

| Parameter | Type | Description |
| --- | --- | --- |
| `snapshots` | `ProbeDebugSnapshot[]` | The array returned by `water.spray.getProbeDebugData()`. |

#### `dispose`

```typescript
dispose(): void
```

Release GPU resources.

Constructor accepts an optional `Partial<SprayDebugConfig>`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `arrowLengthPerSpeed` | `number` | `0.3` | Arrow length (m) per 1 m/s of probe speed. |
| `arrowMaxLength` | `number` | `12.0` | Maximum arrow length (m). |
| `disabledColor` | `number` | `0x666666` | Sphere colour for disabled probes. |
| `inactiveColor` | `number` | `0x4488ff` | Sphere colour for probes not firing this frame. |
| `playingColor` | `number` | `0x44ff44` | Sphere colour while a plume is on screen. |
| `respawningColor` | `number` | `0xffcc00` | Sphere colour during the respawn cooldown. |
| `sphereRadius` | `number` | `0.6` | Wireframe sphere radius (m). |
| `sphereSegments` | `number` | `8` | Sphere wireframe segment count. |

## Limits

- Maximum simultaneously registered emitters: `MAX_EMITTERS = 16`.
- Probes per emitter: `MAX_PROBES_PER_EMITTER = 32`.
- Linear velocity is internally clamped to 100 m/s, angular velocity to 20 rad/s.
- Probes are stored in object-local space and follow only the root transform. They do not track skinning or morph-target deformation. Animated rigid props work correctly.

## Quality levels

The pool size is fixed at `MAX_EMITTERS × MAX_PROBES_PER_EMITTER` whenever the system is allocated. Quality levels only control whether the pool is allocated. The `enabled` flag itself comes from the loaded preset, and every bundled preset enables spray; the flag has no visible effect where the pool is unallocated.

| Quality | Allocated | Renders |
| --- | --- | --- |
| Low | No | No |
| Medium | No | No |
| High | Yes | Yes |
| Ultra | Yes | Yes |
