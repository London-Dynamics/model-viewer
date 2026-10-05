# Multiplayer

Three.js Water Pro's wave simulation supports synchronized wave simulations across multiple clients for multiplayer apps and games.

Given the same `seed`, parameters, `stepSize`, and `tick`, every client renders the same wave surface.

::: info
The library does not include netcode. It provides one sync primitive, `syncToTick`, which snaps the local simulation to a tick of your choosing.
:::

## 1. Construct WaterSystem in Deterministic Mode

```typescript
const water = await WaterSystem.create(renderer, scene, camera, "high", {
  deterministic: true,
  seed: session.seed,
});
```

`deterministic: true` runs the simulation on a fixed step so clients at different frame rates advance identically. Use the same `seed` on every client. 

The default seed is `1`, which is suitable for local testing but means every session looks identical. Pass an explicit session seed in production.

You can also change `water.deterministic` at runtime instead of fixing it at construction. Toggling it preserves absolute simulation time, so wave phases continue unbroken. Switching from non-deterministic to deterministic mode snaps to the nearest integer tick; call `syncToTick` afterwards if you need an exact authoritative tick.

## 2. Drive `update()` Normally

```typescript
async function animate() {
  await water.update(clock.getDelta());
  water.render();
  requestAnimationFrame(animate);
}
```

## 3. Sync to an Authoritative Tick

Call `water.syncToTick(n)` whenever your network layer has an authoritative tick to apply. The same call serves both as the initial join and as ongoing drift correction. 

```typescript
network.on("tick", ({ tick }) => {
  water.syncToTick(tick);
});
```

`n` must be a finite integer. Forward and backward snaps are both allowed, although effects with a time history, such as persistent foam, may take a few seconds to reach their new steady state.

`syncToTick` is instant; it does not run catch-up substeps regardless of how far the target is from the current local tick.

### Handling Tick Wraparound

The simulation automatically handles wrap-around of the tick value. Internally, the simulation is set to repeat every 8192 seconds (a little more than 2 hours).
