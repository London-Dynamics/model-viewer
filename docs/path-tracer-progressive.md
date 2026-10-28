# Progressive path-tracer quality pipeline

Status: design for the LD path-tracer mixin. Implementation lives in
`packages/model-viewer/src/features/ld-path-tracer.ts` and
`packages/model-viewer/src/three-components/postprocessing/ld-path-tracer/`.

The mixin stays the product API. Examples only set `path-tracer` and call
`setPathTracerOptions`. No new HTML attributes.

## Problem

`path-tracer` today swaps the beauty pass for `WebGLPathTracer`. The first
frames wait on a scene merge and a BVH, and the traced image is the only
image. Configurators cannot use that on a boat or a car: the camera has to
stay live, geometry changes when options change, and lights turn on and off.

Shader AO (`ld-ambient-occlusion`) is not a substitute. It is fine on some
cars and not good enough on a bag, and a Blender bake does not survive a
configurator that rebuilds the mesh. This pipeline bakes in the viewer, per
configuration, without taking the realtime frame away.

## Mode

The pipeline is off unless both of these are true:

- the existing `path-tracer` attribute is set
- `setPathTracerOptions({mode: 'progressive'})`

`mode` defaults to `'immediate'`, which is the current tracer: same BVH
worker, same `path-tracer-ready` rule, same attribute knobs. Realtime
rendering is unchanged when `path-tracer` is unset.

Fine-grained settings are only on `setPathTracerOptions` /
`getPathTracerOptions`. They sit beside the existing BVH fields
(`strategy`, `maxLeafTris`).

## What a frame does

`Renderer` still calls the effect composer. In progressive mode the composer
does not replace the beauty pass.

1. Plain realtime renders first: environment, tone mapping, the soft-shadow
   floor, and the materials. If the scene has shader AO on
   (`ambient-occlusion`), that pass draws this phase. It is the preset
   look, not a second bake.
2. A CPU slice of at most `budgetMs` (default 4) advances the bake. The slice
   checks the clock and returns. BVH construction runs in a second
   `PathTracerBVHWorker`, not on the main thread.
3. Bake results are normal scene content: a ground mesh, `aoMap` on UV
   channel 1, a composited `lightMap` on the same channel, and a PMREM
   `envMap`. The baked contact shadow and texture AO **replace** shader AO.
   They do not stack with it. See the handoff below.
4. When the camera has been still for `idleDelayMs`, the existing
   `WebGLPathTracer` accumulates **one tile** into an offscreen target
   (`renderToCanvas = false`). After `traceRevealSamples` and a denoise, a
   fullscreen quad crossfades that target over the beauty pass. At fade 1
   the quad is opaque and fully replaces realtime. There is no persistent
   opacity blend.
5. Camera motion fades that quad back out. Realtime, the bakes, and the
   probes remain.

The path-tracer scene merge (`StaticGeometryGenerator`) is still synchronous
inside three-gpu-pathtracer. Progressive mode **defers that merge until the
camera is idle**, so orbiting does not pay it. The idle frame that starts
the trace can still hitch once. That hitch is called out under Risks.

## Shader AO handoff

Shader AO stays available for the plain realtime phase. If
`ambient-occlusion` is set, that pass draws until a baked AO layer or the
full trace takes over. The two never run at full strength together.

`shaderAoMix` is `1 - max(contactFade, textureAoFade, traceFade)`, clamped
to 0..1. The real-time pass uses `authoredIntensity * shaderAoMix`. Contact
fade and texture-AO fade are the baked AO layers. Light layers and probes
do not move this mix. The mix uses the same fade values as those layers, so
the cross-fade takes `fadeMs` and no second clock.

| Phase | Shader AO | Baked AO | Full trace |
| --- | --- | --- | --- |
| Pure realtime, attribute on | authored | hidden | hidden |
| Contact or texture AO fading in by `t` | authored × (1 − t) | fading in by `t` | hidden |
| Either baked AO layer fully shown | off | shown | hidden or fading |
| Full trace fading in by `t` | authored × (1 − max(t, baked)) | whatever is still up | fading in |
| Geometry change (or every baked AO layer and the trace faded out) | fades back to authored | fading out | fading out |

Disabling a layer sets its fade target to 0. Shader AO comes back only
once contact, texture AO, and the trace have all reached 0, which is the
pure realtime phase again. Removing `path-tracer` or leaving progressive
mode restores the authored intensity on the next frame.

## Layers

Each layer has its own fade channel (`fadeMs`, default 600). A result fades
in only after its bake exists. Invalidation fades a layer out, and the next
bake starts only once that fade has reached 0, so a stale texture never
pops back in.

| Layer | What is baked | Where it shows |
| --- | --- | --- |
| Contact shadow | Ray-cast occlusion on a plane under the bounds | Extra mesh on `scene.target` |
| Texture AO | Hemisphere occlusion into a texture | `material.aoMap`, UV channel 1 |
| Light layers | Direct light, one texture per light | Summed into one `lightMap` |
| Probes | Cubemap + PMREM | `material.envMap` while the trace is hidden |
| Full trace | Existing tiled path tracer | Opaque quad once revealed |

`bake.lightmap.enabled` is accepted and stored. A separate indirect lightmap
(multi-bounce, not tied to a switchable light) is not baked in this phase.
Switchable illumination is the light-layer path below.

### 1. Contact shadow

Cheapest layer, and it does not need UVs.

- Plane sits on the bounds' XZ footprint at `min.y`, about 1.5× the
  footprint so the penumbra has room. Front face points up. It is not part
  of the raycast BVH (`userData.progressiveOverlay`).
- Each texel shoots `samples` rays straight up. Origins are jittered in a
  disk of radius `softness` × the larger horizontal size (Halton, stable
  across rebakes). A hit within the model height counts as occlusion.
- A small separable blur kills leftover noise.
- The texture is black RGB with occlusion in alpha. Opacity is
  `contactShadow.opacity * fade`. `depthWrite` is off.

Meshes with `userData.noHit` (the built-in soft-shadow floor) are not in
the BVH, or the floor would occlude every upward ray.

### 2. Texture AO and UV2

Checked only when the geometry fingerprint changes. The fingerprint is mesh
uuid plus the **source** geometry uuid and position count. The UV clone we
install is not a new fingerprint, or the bake would loop.

A second UV set (`uv1` / glTF `TEXCOORD_1`) is valid when it exists, is not
degenerate, and a low-res raster of its triangles does not overlap. An
overlap is treated as missing. None of the three review scenes ship
`TEXCOORD_1`.

Missing UVs are generated per mesh, time-sliced:

- Edge hash, then charts grown across edges whose dihedral is gentler than
  about 45°. Charts cap so one chart cannot eat a concave shell.
- Each chart is projected onto its average normal, packed into the AO
  resolution with a two-pixel gutter, and scaled down uniformly if the pack
  overflows.
- Seam vertices are duplicated. Other attributes (including `uv` / TEXCOORD_0)
  are copied from the source vertex so base-color maps stay put. The source
  geometry is kept on the mesh and restored when the pipeline disposes or
  the mode leaves progressive.

AO is cosine-weighted hemisphere occlusion, ray length `distance` or 0.35×
the bounds diagonal when `distance` is 0, with a normal bias so a surface
does not shadow itself. The value is stored in the red channel. Fade is
`aoMapIntensity` from 0 to 1, which matches three.js's AO formula (intensity
0 leaves the shading unchanged). The GPU upload happens once; the fade does
not reallocate.

### 3. Light layers

Lights are:

- punctual lights already in the scene (`KHR_lights_punctual` becomes
  `PointLight` / `SpotLight` / `DirectionalLight`)
- one layer per emissive material (`emissive` × `emissiveIntensity`)

Each layer is direct irradiance only, normalized to intensity 1, into its
own texture on the same UV2 layout as AO. A blocked ray contributes 0.
Emissive layers sample a fixed set of area-weighted points on that
material's triangles.

`lights.separateLayers` (default true) keeps those textures. The displayed
`lightMap` is a GPU additive composite. A light's weight is
`visible ? intensity / bakedIntensity : 0` (emissive: current
`emissiveIntensity` over the baked one). Weight changes replay the
composite. They do not rebake. The composite is half-float so a headlight
is not clamped to 1 before tone mapping.

`lights.include: false` skips the layer. `separateLayers: false` bakes one
combined texture and a toggle rebakes that texture; the default stays
separate so a boat's light switch does not.

Rect-area lights are approximated as a point at the light's position.

### 4. Reflection probes

Reflections move with the camera, so they are not in the AO or light
textures.

- `probes.count` probes (clamped 1–4) sit just outside the bounds, the
  first along the view direction at bake time, the rest on a ring around Y.
- Each cubemap is rendered one face per frame. A second cubemap hides the
  product and keeps the background, at the same resolution.
- Both become PMREMs. A fullscreen blend of those two same-size PMREMs is
  the `envMap`. Fade 0 matches the background-only probe (close to the
  realtime IBL when the skybox and the environment agree). Fade 1 includes
  the product in the reflections.
- While the camera moves, the nearest baked probe is selected. A change of
  nearest probe crossfades the same way. Probes do not follow the camera.
- The full trace does not use `material.envMap` (three-gpu-pathtracer
  samples the scene environment). Swapping `envMap` does not change the
  traced image.

### 5. Full path trace

Unchanged tracer, different presentation.

- Build is deferred until idle. Overlays are hidden only for the synchronous
  mesh collect inside `setSceneAsync`, then shown again before the next
  paint, so the contact plane is not in the trace BVH and does not disappear
  for the length of the worker build.
- `pause` is "do not call `renderSample`". One tile per idle frame, and only
  if the CPU slice returned early. If a tile's GPU time exceeds the budget,
  `tiles` on the tracer (not the attribute) steps up to 8×8 so the next tile
  is smaller.
- The quad stays at opacity 0 until `samples >= traceRevealSamples` and, when
  `path-tracer-denoise` is on, one denoise pass has been written. Then it
  fades 0→1 over `fadeMs` and stays at 1 (NoBlending, full replace).
- Camera motion sets the fade target to 0 and resets accumulation. It does
  **not** clear `isPathTracerReady`. That matches the immediate-mode rule:
  camera motion restarts samples and does not refire `path-tracer-ready`.

`path-tracer-ready` still means "BVH built and the first tile landed",
including in progressive mode, where that happens after the first idle
period rather than at load.

## Scheduling

```
collect world positions (sliced)
        │
        ├─ bake BVH worker ───────────── contact rays ─ blur ─ fade in
        │
        └─ per mesh: overlap test or chart UV (sliced)
                    │
                    surface cache (texel → world pos/normal)
                    │
                    AO rays ─ upload aoMap ─ fade in
                    │
                    per light rays ─ upload layer ─ composite ─ fade in

probes: one cubemap face on frames where the CPU slice returned early
full trace: one tile once idle, same rule
```

Contact tracing starts as soon as the bake BVH exists. It does not wait for
UVs. Probe faces and trace tiles wait for leftover frame time so they do not
stack on a full CPU slice.

Fingerprint, once per frame, after the slice:

- geometry: sorted mesh uuid + source geometry uuid + position count
- material: color, roughness, metalness, opacity, emissive color, base map,
  normal map. Not `aoMap`, `lightMap`, `envMap`, or `emissiveIntensity`
  (those are ours, or a dimmer).
- lights: id → intensity, visibility, color
- environment texture identity, when `environment` is null

Our contact plane and our UV clone are excluded from the geometry key.

## Invalidation

| Change | Contact | AO | Light textures | Probes | Full trace |
| --- | --- | --- | --- | --- | --- |
| Geometry (mesh added/removed, source geometry identity) | fade out, rebake all | fade out, rebake | fade out, rebake | fade out, rebake | fade out, rebuild |
| Material (color, roughness, metalness, maps, emissive color) | keep | keep | keep | fade out, rebake | fade out, reset samples |
| Light toggle or dim (`intensity`, `visible`, `emissiveIntensity`) | keep | keep | fade that layer's weight, no rebake | fade out, rebake | fade out, reset samples |
| Camera move | keep | keep | keep | keep (nearest may crossfade) | fade out, reset samples |
| Bake environment URL, or the realtime environment when `environment` is null | keep | keep | keep | fade out, rebake | fade out, reset samples |
| `path-tracer` turned off, or mode back to `immediate` | dispose, restore source geometry and maps | dispose | dispose | dispose | dispose |

A geometry change does not try to reuse a part's old bake. Per-part caches
are later work.

Fades run to 0 before the replacement texture is published. Disabling a
layer through the API is the same fade-out, without a rebake.

## API

`setPathTracerOptions` / `getPathTracerOptions` return the BVH fields plus:

```ts
{
  mode: 'immediate' | 'progressive',   // default 'immediate'
  fadeMs: number,                      // default 600
  traceRevealSamples: number,          // default 6
  idleDelayMs: number,                 // default 500
  budgetMs: number,                    // default 4, CPU slice cap
  environment: string | null,          // null = the realtime environment
  bake: {
    contactShadow: {
      enabled: boolean,                // default true once mode is progressive
      resolution: number,              // default 192
      softness: number,                // default 0.08, fraction of footprint
      opacity: number                  // default 0.7
    },
    textureAO: {
      enabled: boolean,                // default true
      resolution: number,              // default 192
      samples: number,                 // default 16
      distance: number                 // default 0 → 0.35 × diagonal
    },
    lightmap: {enabled: boolean}       // default false, reserved
  },
  lights: {
    include: boolean,                  // default true
    separateLayers: boolean            // default true
  },
  probes: {
    enabled: boolean,                  // default true
    count: number,                     // default 1, max 4
    resolution: number                 // default 64, cubemap face
  }
}
```

Nested objects merge. Unknown `mode` or `strategy` is ignored. Resolutions
clamp to at least 8. `opacity`, `softness`, and sample counts clamp to a
sane range. Passing the current BVH fields still does not rebuild.

Readiness, all false while the bake has not landed (fade can still be in
progress):

- `isContactShadowReady`
- `isTextureAoReady`
- `isLightLayersReady`
- `isProbesReady`
- `isPathTracerReady` (existing: first traced tile)

`getPathTracerProgressiveState()` is the debug/readout used by tests and the
review harness: per-layer `{ready, fade, progress}`, trace
`{samples, fade, revealed}`, and frame-time `{last, mean, max, p95}` plus
per-layer bake milliseconds. Frame times are the composer render duration,
sampled while a bake or a fade is running.

### Events

Dispatched on `<model-viewer>`:

| Event | When |
| --- | --- |
| `contact-shadow-ready` | occlusion texture uploaded |
| `ao-ready` | aoMap uploaded |
| `light-layers-ready` | every included light has a texture |
| `probes-ready` | PMREM blend is assigned |
| `path-tracer-ready` | existing first-tile signal |

`detail` is `{progress, ready, fade, elapsedMs}`. Progress events with
`ready: false` are throttled to about 5 Hz while that layer is baking.
`ready: true` fires once per bake generation. A geometry restart can fire
them again. Listeners that mean "landed" should check `detail.ready`.

### Environment

`environment: null` uses `scene.environment` for the trace and as the probe
background. A string is loaded with `RGBELoader` and installed only inside
`updateEnvironment` (swap, update, restore) so the realtime IBL does not
change. Contact and AO ignore it (they are occlusion). Light layers are
direct lights, not the HDR.

## Workers and memory

- Trace BVH: existing `path-tracer-bvh.worker.js`, one job at a time.
- Bake BVH: a second `PathTracerBVHWorker` so a contact bake is not rejected
  while the trace worker is busy. Same script, `maxLeafTris` 4.
- UV charts and raycasts stay on the main thread, sliced. A wasm xatlas
  worker is the upgrade path if chart seams show on the boat; the overlap
  test and the "only when geometry changes" rule stay either way.
- If the bake worker fails to start, the BVH is built on the main thread and
  a warning is logged, same fallback as the tracer.

Rough budget at the defaults, Aquila lights-on (31 punctual lights + a
handful of emissive materials), AO resolution 192:

| Buffer | Order of magnitude |
| --- | --- |
| Bake BVH + world copy | tens of MB, released after dispose |
| AO texture | 192² RGBA8 |
| 36 half-float light layers | ~10 MB |
| Light composite RT | 192² half-float |
| Probe cubemaps + 2 PMREMs | a few MB at 64² |
| Trace target | viewport × `path-tracer-render-scale` |

The UV clone is the spike. Seam-only duplication keeps it near the source
vertex count instead of 3× the triangle count. Montana 001112 (2027) is two
Draco meshes and about 675k triangles and is the chart-job stress case;
Aquila is many smaller meshes.

## Phase 1 (this work) and later

Phase 1, all of it in this change:

- progressive mode, options, fades, invalidation, events, readiness
- contact shadow
- UV2 when missing or overlapping, texture AO
- per-light direct layers, including emissive materials and punctual lights
- one-to-four probes and the idle full-trace handoff
- tests for the option merge, the invalidation table, and the fade step

Later, not in this change:

- `bake.lightmap` multi-bounce
- xatlas (or equivalent) instead of chart projection
- per-part bake reuse across an option swap
- time-sliced `StaticGeometryGenerator` so the idle trace build cannot hitch
- skinned-mesh posing (bakes read the bind-pose position attribute)
- more than a nearest-probe blend

## Risks

- **Idle trace merge hitch.** Deferred, but the first idle `setScene` still
  merges on the main thread. Review timings call this out separately from
  the sliced bake.
- **Shader compile.** The first trace tile compiles the path-tracer material
  synchronously. It happens after idle, not during the orbit, and it is one
  frame.
- **SwiftShader.** Headless review may not have a GPU. Tile time dominates
  the full-trace numbers there. Bake rays are CPU and are the fair stall
  measurement.
- **Shader AO handoff.** Aquila's preset turns SSAO on, so the plain
  realtime frame includes it. The mix above turns that pass down as the
  first baked AO layer or the trace fades in, and brings it back only when
  those are gone. Review frames: baseline is the preset as stored (Aquila
  includes shader AO). Every baked or traced frame has shader AO off. An
  extra frame per scene is realtime with shader AO forced off (Aquila) or
  on (scenes whose preset leaves it off), so the bake can be compared with
  both.
- **Stacked ground shadows.** The built-in soft-shadow floor stays, because
  "feature off" must match today and "feature on" adds a layer. If the two
  planes z-fight or double, the contact plane moves, it does not disable the
  preset.
- **Chart UV seams** on hard edges, and overlaps inside a chart that is not
  actually planar. Padding and dilation reduce the halo. They will not match
  a Blender xatlas bake.
- **Probe parallax** from a single cubemap, and a pop if the skybox and the
  environment HDR differ, because fade 0 is a background capture rather than
  the original PMREM.
- **Emissive color edits** keep the old light texture (material rule).
  Intensity edits scale it. A color change that should rebake the layer is
  an open product question.
- **`envMap` shader compile** the first time a probe is assigned.

## Review scenes

Presets are the default configurator attributes (see the scene README):

- Aquila 45 Sport, published default, plus the lights-on GLB for layers and
  a toggle
- Triton Master Scene V3, Draco, interior, almost no lights
- Montana 001112 (2027), the published shelf on castors (Draco, two meshes,
  about 675k triangles, no lights). The earlier qa-001112 stand-in is not
  used.

Images are a fixed-camera progression. The realtime frame uses the scene
preset as stored, so Aquila includes shader AO and Triton and Montana do
not. Contact shadow, texture AO, lights (Aquila on/off), probes, and the
revealed trace are shader-AO off. An extra realtime frame shows the other
AO state: Aquila with shader AO forced off, Triton and Montana with the
mixin turned on.
