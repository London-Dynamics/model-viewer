# Spray

Spray plumes that fire when a moving object hits the water (or a wave hits a stationary object). Available on the WebGPU backend only — `water.spray` is `null` on WebGL.

## Emitters and Probes

Spray has two concepts:

- An **emitter** is one registered scene object. Its world transform drives every probe attached to it; the system tracks the object across frames to derive linear and angular velocity.
- A **probe** is a single point in that object's local space. Each probe holds its own state and fires its own plume independently of the others.

**One emitter per object.** If two impact points share a transform — bow and stern of the same ship, or two corners of the same crate — they belong on the same emitter as separate probes. If two objects move independently, they need separate emitters.

```
Ship          → 1 emitter, N probes (bow tip, bow cheeks, stern, …)
Falling crate → 1 emitter, 1 probe  (bottom centre)
A fleet       → 1 emitter per ship
```

Probes on the same emitter inherit the emitter's parameters, so a ship-wide change like `size` or `respawnTime` only needs to be set once. Use per-probe overrides only for probes that genuinely differ from their siblings (a taller plume off the bow tip, a quieter one at the stern).

## When a Probe Fires

Each frame, the system tracks every probe against the displaced water surface. The moment a probe crosses the surface from above, the system measures **impact speed**: the rate at which the probe and the surface are converging vertically. If that exceeds `velocityThreshold`, a plume fires from the probe's current world position.

The gate is symmetric — these two cases produce the same impact speed:

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

When the crate falls onto the water, the probe at the bottom of its bounding region crosses the surface and a plume fires from the impact point. Leave the crate stationary at the waterline and a wave rolling over it produces the same plume — the gate is symmetric.

## Authoring a Probe Rig

For complex objects (boats, ships, buoys with multiple impact points), place several probes:

```typescript
const shipId = water.spray.addEmitter(shipModel, {
  probes: [
    // Bow tip — taller plume, lower velocityThreshold so it triggers easily.
    {
      local: new THREE.Vector3(0, 0, 0.5),
      stretchY: 1.6,
      velocityThreshold: 0.6,
    },
    // Bow cheeks
    { local: new THREE.Vector3(-0.12, 0, 0.4) },
    { local: new THREE.Vector3(0.12, 0, 0.4) },
    // Mid hull — start with these disabled, only fire the cheeks.
    { local: new THREE.Vector3(-0.15, 0, 0.0), enabled: false },
    { local: new THREE.Vector3(0.15, 0, 0.0), enabled: false },
    // Stern — quieter, faded
    { local: new THREE.Vector3(-0.12, 0, -0.4), opacity: 0.25 },
    { local: new THREE.Vector3(0.12, 0, -0.4), opacity: 0.25 },
  ],
  // Per-emitter overrides — bigger plumes off this ship than the system default.
  size: 35.0,
  velocityThreshold: 1.0,
  respawnTime: 0.8,
});

// Toggle a mid-hull probe on at runtime.
water.spray.setProbeEnabled(shipId, 3, true);
```

A few things to notice:

- **Probes live in object-local space.** They follow the object's transform automatically, so a yawing or pitching ship gets the right per-probe motion.
- **The `enabled` flag persists.** Disabled probes still occupy their slot, so probe indices stay stable for `setProbeEnabled` calls.
- **Per-emitter overrides win over system defaults.** `size: 35.0` on this ship overrides whatever `water.spray.size` is.
- **Per-probe overrides win over emitter values.** The bow tip's `stretchY: 1.6` and the stern's `opacity: 0.25` survive subsequent changes (see below).

## Override Precedence

Every spray parameter (`size`, `opacity`, `velocityThreshold`, lifetimes, fades, …) can be set at three levels, in order of precedence:

1. System defaults
2. Per-emitter overrides
3. Per-probe overrides

When you change a system default later:

```typescript
water.spray.opacity = 0.6;
```

…it propagates to every emitter and every probe **except** the ones that authored their own value for that key. So in the ship example above, the stern probes keep their `opacity: 0.25` even after this assignment runs.

`updateEmitter(id, { … })` follows the same rule: it patches the emitter, but per-probe overrides on that emitter are preserved.

If you want to change a probe's position or its overrides, remove and re-add the emitter — probes are baked at registration. To toggle a single probe on or off without re-registering, use `setProbeEnabled(emitterId, probeIndex, enabled)`.

## Tuning the Plume

The shape and timing of each plume comes from a handful of parameters. The defaults are chosen for ship-bow-on-ocean — start there and adjust:

- **`size`** — base billboard side length in meters. Bigger = larger plume.
- **`stretchX` / `stretchY`** — width and height multipliers. `stretchY > 1` for tall pillars, `stretchX > 1` for wide sheets.
- **`opacity`** — master alpha multiplier.
- **`bottomFadeStart` / `bottomFadeStop`** — soften the seam where the plume meets the water by fading its bottom edge transparent.
- **`submersionDepth`** — push the bottom of the billboard slightly below the surface so the seam sits underwater.
- **`duration`** — how long a plume stays alive before it dies.
- **`fadeOutTime`** — how much of `duration` is spent fading to zero alpha at the end.
- **`velocityThreshold`** — minimum impact speed (m/s) to trigger. Lower for delicate effects (a buoy bobbing), higher for heavy splashes only.
- **`respawnTime`** — extra cooldown after a plume dies before the same probe can fire again. Prevents a single probe from firing every frame in choppy water.
- **`spawnJitterTime`** — random delay (s) between trigger and visible spawn. `0` means every trigger spawns the same frame; non-zero spreads bursts out so an array of probes doesn't look like one synchronised pop.
- **`velocityScaleFactor` / `velocityHeightFactor`** — scale the plume by impact speed at the moment it fires. `0` disables; both cap at 2× the base size.

Visual params are frozen onto each plume at spawn — a live plume keeps its appearance even if you change the parameter mid-flight.

## Debug Visualizer

`SprayDebugVisualizer` renders each probe as a coloured wireframe sphere with a velocity arrow. Useful while placing probes:

```typescript
import { SprayDebugVisualizer } from "threejs-water-pro";

const vis = new SprayDebugVisualizer(scene);
vis.setEnabled(true);

// In your render loop:
if (vis.isEnabled() && water.spray) {
  vis.update(water.spray.getProbeDebugData());
}
```

Sphere colour reflects the probe's lifecycle:

- **Grey** — disabled (the probe's `enabled` flag is off).
- **Blue** — inactive (no crossing this frame, or the impact was below `velocityThreshold`).
- **Green** — playing (a plume is currently on screen).
- **Yellow** — respawning (cooldown not yet elapsed).

The arrow points along the probe's instantaneous world velocity (linear + angular contribution from the parent object). Note that the firing gate is _impact_ speed (probe-vs-surface), not probe speed — a stationary probe can still fire when a wave rises onto it, even though its arrow is a stub.

The state shown is approximated CPU-side using mean water height, so it can disagree with the GPU emission decision in rough seas. It's there for placement validation, not frame-accurate inspection.
