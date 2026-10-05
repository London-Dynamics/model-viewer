# Spray

The spray system emits plumes when a moving object hits the water, or when a wave hits a stationary object. Spray is available on the WebGPU backend only; `water.spray` is `null` on WebGL.

## Emitters and Probes

Spray has two concepts:

- An **emitter** is one registered scene object. Its world transform drives every probe attached to it; the system tracks the object across frames to derive linear and angular velocity.
- A **probe** is a single point in that object's local space. Each probe holds its own state and fires its own plume independently of the others.

Register one emitter per object. If two impact points share a transform, such as the bow and stern of the same ship, add them to the same emitter as separate probes. If two objects move independently, register a separate emitter for each.

```
Ship          → 1 emitter, N probes (bow tip, bow cheeks, stern, …)
Falling crate → 1 emitter, 1 probe  (bottom centre)
A fleet       → 1 emitter per ship
```

Probes on the same emitter inherit the emitter's parameters, so a ship-wide change such as `size` or `respawnTime` only needs to be set once. Use per-probe overrides only for probes that differ from the others, such as a taller plume at the bow tip or a fainter one at the stern.

## When a Probe Fires

Each frame, the system tracks every probe against the displaced water surface. The moment a probe crosses the surface from above, the system measures **impact speed**: the rate at which the probe and the surface are converging vertically. If that exceeds `velocityThreshold`, a plume fires from the probe's current world position.

The trigger is symmetric. These two cases produce the same impact speed:

- A boat's bow falling onto still water.
- A wave rising onto a stationary rock or pier piling.

Both fire at the same `velocityThreshold`. Crossings slower than that are ignored.

## Quick Start

Place one probe at the bottom of an object and let `water.spray` handle the rest:

```typescript
import * as THREE from "three/webgpu";

const crate = new THREE.Mesh(crateGeometry, crateMaterial);
scene.add(crate);

if (water.spray) {
  water.spray.addEmitter(crate, {
    probes: [{ local: new THREE.Vector3(0, -0.5, 0) }],
  });
  water.spray.velocityThreshold = 2.0;
}
```

When the crate falls onto the water, the probe at the bottom of its bounding region crosses the surface and a plume fires from the impact point. If the crate is stationary at the waterline, a wave rolling over it produces the same plume.

## Authoring a Probe Rig

For complex objects (boats, ships, buoys with multiple impact points), place several probes:

```typescript
const shipId = water.spray.addEmitter(shipModel, {
  probes: [
    // Bow tip: taller plume, with a lower velocityThreshold so it triggers easily.
    {
      local: new THREE.Vector3(0, 0, 0.5),
      stretchY: 1.6,
      velocityThreshold: 0.6,
    },
    // Bow cheeks
    { local: new THREE.Vector3(-0.12, 0, 0.4) },
    { local: new THREE.Vector3(0.12, 0, 0.4) },
    // Mid hull: start disabled; only the cheeks fire.
    { local: new THREE.Vector3(-0.15, 0, 0.0), enabled: false },
    { local: new THREE.Vector3(0.15, 0, 0.0), enabled: false },
    // Stern: fainter plumes.
    { local: new THREE.Vector3(-0.12, 0, -0.4), opacity: 0.25 },
    { local: new THREE.Vector3(0.12, 0, -0.4), opacity: 0.25 },
  ],
  // Per-emitter overrides: larger plumes on this ship than the system default.
  size: 35.0,
  velocityThreshold: 1.0,
  respawnTime: 0.8,
});

// Toggle a mid-hull probe on at runtime.
water.spray.setProbeEnabled(shipId, 3, true);
```

Notes:

- **Probes are defined in object-local space.** They follow the object's transform automatically, so a yawing or pitching ship produces the correct per-probe motion.
- **The `enabled` flag persists.** Disabled probes still occupy their slot, so probe indices stay stable for `setProbeEnabled` calls.
- **Per-emitter overrides take precedence over system defaults.** `size: 35.0` on this ship overrides the current value of `water.spray.size`.
- **Per-probe overrides take precedence over emitter values.** The bow tip's `stretchY: 1.6` and the stern's `opacity: 0.25` are preserved through subsequent changes. See [Override Precedence](#override-precedence).

## Override Precedence

Every spray parameter (`size`, `opacity`, `velocityThreshold`, lifetimes, fades, …) can be set at three levels, in order of precedence:

1. System defaults
2. Per-emitter overrides
3. Per-probe overrides

When you change a system default later:

```typescript
water.spray.opacity = 0.6;
```

The change propagates to every emitter and every probe except those that set their own value for that key. In the ship example above, the stern probes keep their `opacity: 0.25` after this assignment runs.

`updateEmitter(id, { … })` follows the same rule: it patches the emitter, but per-probe overrides on that emitter are preserved.

Probes are fixed at registration. To change a probe's position or its overrides, remove and re-add the emitter. To toggle a single probe on or off without re-registering, use `setProbeEnabled(emitterId, probeIndex, enabled)`.

## Tuning the Plume

The shape and timing of each plume are controlled by the following parameters. The defaults are tuned for a ship bow on the open ocean.

- **`size`**: Base billboard side length in meters.
- **`stretchX` / `stretchY`**: Width and height multipliers. Use `stretchY > 1` for tall pillars and `stretchX > 1` for wide sheets.
- **`opacity`**: Master alpha multiplier.
- **`bottomFadeStart` / `bottomFadeStop`**: Soften the seam where the plume meets the water by fading its bottom edge to transparent.
- **`submersionDepth`**: Places the bottom of the billboard below the surface so that the seam sits underwater.
- **`duration`**: How long a plume stays alive, in seconds.
- **`fadeOutTime`**: The portion of `duration` spent fading to zero alpha at the end.
- **`velocityThreshold`**: Minimum impact speed in m/s required to trigger a plume. Use lower values for subtle effects such as a bobbing buoy, and higher values to fire only on heavy splashes.
- **`respawnTime`**: Cooldown after a plume ends before the same probe can fire again. This prevents a single probe from firing every frame in choppy water.
- **`spawnJitterTime`**: Random delay in seconds between trigger and visible spawn. At `0`, every trigger spawns on the same frame. Nonzero values spread bursts out so that an array of probes does not spawn in unison.
- **`velocityScaleFactor` / `velocityHeightFactor`**: Scale the plume by impact speed at the moment it fires. `0` disables the scaling. Both factors cap at twice the base size.

Visual parameters are captured when a plume spawns. A live plume keeps its appearance even if a parameter changes while it plays.

## Debug Visualizer

`SprayDebugVisualizer` renders each probe as a coloured wireframe sphere with a velocity arrow. It is useful while placing probes:

```typescript
import { SprayDebugVisualizer } from "threejs-water-pro";

const vis = new SprayDebugVisualizer(scene);
vis.setEnabled(true);

// In your render loop:
if (vis.isEnabled() && water.spray) {
  vis.update(water.spray.getProbeDebugData());
}
```

The sphere colour reflects the probe's lifecycle:

- **Grey**: Disabled. The probe's `enabled` flag is off.
- **Blue**: Inactive. There was no surface crossing this frame, or the impact was below `velocityThreshold`.
- **Green**: Playing. A plume is currently on screen.
- **Yellow**: Respawning. The cooldown has not yet elapsed.

The arrow points along the probe's instantaneous world velocity, including the linear and angular contributions from the parent object. The firing condition is impact speed between the probe and the surface, not probe speed, so a stationary probe can still fire when a wave rises onto it.

The state shown is approximated on the CPU using mean water height, so it can disagree with the GPU emission decision in rough seas. It is intended for placement validation, not frame-accurate inspection.
