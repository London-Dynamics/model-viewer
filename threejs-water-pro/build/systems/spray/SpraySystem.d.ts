/**
 * Scene-driven spray particle system.
 *
 * Spray is emitted at the contact point between a registered scene object
 * and the water surface. Each emitter ships a list of authored
 * `SprayProbe`s — hand-placed positions in object-local space, each with
 * an independently toggleable `enabled` flag. The emission compute
 * transforms every probe into world space, computes the vertical
 * convergence rate between probe and surface over the last frame
 * (`impactSpeed = (prevSignedDist − signedDist) / dt`), and **schedules**
 * a burst the moment the probe crosses the displaced water surface from
 * above with `impactSpeed > velocityThreshold`. The relative-velocity gate is
 * symmetric — a moving probe falling onto still water and a stationary
 * probe (rock, pier piling) struck by a rising wave both register the
 * same magnitude.
 *
 * Schedule / dispatch: a scheduled burst carries a random dwell ∈
 * `[0, spawnJitterTime)` before the particle is actually written. The
 * particle spawns at the probe's **current** world position when the
 * dwell expires, so a moving boat that travels several meters during
 * the dwell still has its plume appear at the probe rather than at the
 * stale crossing point. Per-probe cooldown after a trigger is
 * `duration + jitter + respawnTime`, so a re-trigger never interrupts a
 * pending or still-playing burst.
 *
 * Per-emitter parameters: every visual / timing tunable on this class
 * (size, opacity, lifetimes, fade, speed gates, …) lives **per emitter**
 * in a GPU params buffer. The system-level setters (`spray.size = …`)
 * keep working — they store a default and broadcast across every
 * registered emitter. `addEmitter(obj, { …, size: 35 })` lets a single
 * emitter override the default; `updateEmitter(id, { … })` patches one
 * emitter's params later. Visual params are frozen onto each particle at
 * spawn so an in-flight burst's appearance stays consistent even if the
 * emitter's params change before it dies.
 *
 * Architecture:
 *   - `EmitterRegistry` — owns per-emitter probe + state + params GPU
 *                         buffers, handles registration lifecycle.
 *   - `EmitterBake`     — pure utility: `SprayProbe[]` → packed floats.
 *   - `emission.ts`     — TSL emission compute.
 *   - `simulate.ts`     — TSL simulation compute (life decay + cull).
 *   - `droplet.ts`      — TSL render shader (instanced billboards).
 *
 * WebGPU only — the simulation runs on storage buffers and compute
 * shaders. Use {@link SpraySystem.tryCreate} to construct; it returns
 * `null` when the renderer/simulation can't support the system.
 */
import * as THREE from "three/webgpu";
import type { IWaveSimulation } from "../../simulation/waves";
import type { WaterSurfaceMaterial } from "../../components/surface/WaterSurfaceMaterial";
import type { CascadeSampler } from "../../shaders/cascadeSampler";
import type { UniformFloatNode } from "../../shaders/types";
import { type AddEmitterOptions, type EmitterParams } from "./EmitterRegistry";
export type { AddEmitterOptions, EmitterParams, ProbeDebugSnapshot, SprayProbe, } from "./EmitterRegistry";
export { DEFAULT_EMITTER_PARAMS, MAX_EMITTERS, MAX_PROBES_PER_EMITTER, } from "./EmitterRegistry";
/**
 * Preset-facing parameters for {@link SpraySystem}. Combines the master
 * `enabled` toggle with the full set of {@link EmitterParams} that get
 * broadcast to every registered emitter when {@link SpraySystem.update}
 * is called.
 */
export interface SprayParams extends EmitterParams {
    /** Master toggle. When false, no compute is dispatched and nothing renders. */
    enabled: boolean;
}
export declare class SpraySystem {
    /**
     * Construct a SpraySystem if the active backend supports the GPU
     * compute pipeline it requires. Returns `null` on WebGL or when the
     * material's cascade sampler isn't available — the caller should treat
     * a `null` return as "spray unavailable on this backend" and continue.
     *
     * @param maxParticles - Pool budget. `0` keeps the system inert
     *   (allocated nothing, no compute, no render).
     */
    static tryCreate(renderer: THREE.WebGPURenderer, oceanSim: IWaveSimulation, material: WaterSurfaceMaterial, maxParticles: number, maskEnabled: UniformFloatNode): SpraySystem | null;
    private _renderer;
    private _oceanSim;
    private _cascadeSampler;
    private _maxCount;
    private _particleBuffer;
    private _particleBufferNode;
    private _registry;
    private _mesh;
    private _geometry;
    private _material;
    private _enabled;
    /**
     * Default per-emitter params. Setters write here and broadcast to every
     * registered emitter; `addEmitter` merges with overrides to produce
     * each emitter's initial params; `updateEmitter` only patches the
     * emitter, not these defaults.
     */
    private _defaults;
    private _meanY;
    private _deltaTime;
    private _time;
    private _sprayTexture;
    private _defaultMaskTexture;
    private _maskTexture;
    private _maskEnabled;
    private _emissionCompute;
    private _simulateCompute;
    private constructor();
    private _allocatePool;
    private _buildComputePasses;
    private _buildRenderMesh;
    /**
     * Build the droplet TSL graph and assign it to the material. Called
     * once at construction and again whenever a bound texture reference
     * changes (e.g., the mask render target after a resize).
     */
    private _assignShaderNodes;
    /** Build a fully-resolved EmitterParams from defaults + override fields. */
    private _resolveEmitterParams;
    /**
     * Register an object as a spray source. Returns an id for later removal,
     * or `-1` if the {@link MAX_EMITTERS} cap has been reached.
     *
     * Spray is driven by **authored probes** — hand-placed positions in
     * object-local space. Per-frame probe velocity is derived from the
     * emitter's linear + angular velocity, so a bow probe on a yawing or
     * pitching ship gets the correct local velocity. A probe fires the
     * moment it crosses the water line from above, gated by the emitter's
     * `velocityThreshold` and a per-probe cooldown.
     *
     * Per-emitter param overrides apply on top of the system's current
     * defaults; omitted fields inherit the default. Editing a default later
     * via `spray.size = …` (or any sibling setter) broadcasts to every
     * registered emitter, overwriting overrides — opt out with
     * `updateEmitter(id, …)` afterwards.
     *
     * @param object - The Three.js object whose `matrixWorld` drives the
     *   emitter each frame.
     * @param options - Configuration; see {@link AddEmitterOptions}.
     *   `options.probes` is required. Any
     *   {@link EmitterParams} field can be supplied here as a per-emitter
     *   override.
     */
    addEmitter(object: THREE.Object3D, options: AddEmitterOptions): number;
    /** Remove a previously registered emitter. Returns true if found. */
    removeEmitter(id: number): boolean;
    /**
     * Update a registered emitter's tunable parameters. Any
     * {@link EmitterParams} field plus `active` may be patched; `probes`
     * are baked at registration and can't be modified — remove and re-add
     * the emitter to change them, or use {@link setProbeEnabled} to toggle
     * individual probes.
     */
    updateEmitter(id: number, options: Partial<AddEmitterOptions>): boolean;
    /**
     * Toggle a single authored probe on/off. Disabling clears the probe's
     * runtime state so re-enabling never inherits a stale crossing edge or
     * a stuck pending burst. Returns true if the emitter + probeIndex
     * resolve to an authored probe.
     */
    setProbeEnabled(emitterId: number, probeIndex: number, enabled: boolean): boolean;
    /**
     * Snapshot all registered probes' current debug state. Use with
     * `SprayDebugVisualizer` (in the demo) or any caller that wants to
     * inspect probe positions, directions, velocities, and approximate
     * firing state.
     *
     * Returns an empty array when the system is unallocated. Allocates
     * fresh `Vector3`s — debug-path only, not perf-critical.
     */
    getProbeDebugData(): import("./EmitterRegistry").ProbeDebugSnapshot[];
    /**
     * @internal
     * Bind the screen-space mask texture from the water mask pass.
     * Called by `RenderPassManager` at construction and on resize, when the
     * underlying render target is recreated and the previous reference is
     * invalidated. Discards spray fragments behind any registered mask
     * object (e.g., the boat hull) so plumes don't visibly cut through
     * geometry.
     */
    setMaskTexture(maskTexture: THREE.Texture): void;
    /**
     * @internal
     * Rebind the emission / simulate compute passes against a new wave
     * simulation and cascade sampler. Called by `WaterSystem.setQualityLevel`
     * after the previous ocean sim and water material have been disposed and
     * fresh ones built — the spray's storage-buffer + sampler references are
     * baked into the compute graphs at build time, so without this they keep
     * reading from the disposed buffers and `surfaceY` returns garbage.
     *
     * The particle pool, emitter registrations, defaults, and uniforms all
     * survive; only the two compute graphs are rebuilt. Alive particles
     * re-anchor to the new surface on the next simulate dispatch.
     *
     * No-op when the system is unallocated (`maxCount === 0`) or when
     * `oceanSim` isn't the WebGPU variant required by the compute pipeline.
     */
    setOceanSim(oceanSim: IWaveSimulation, cascadeSampler: CascadeSampler): void;
    /** @internal Scene object for the spray renderer. Add to the scene once. */
    getMesh(): THREE.Object3D;
    /** Whether spray is enabled. Disabled spray skips all compute dispatches. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Maximum particles allocated in the pool (read-only, quality-driven). */
    get maxCount(): number;
    /** Base billboard side length in meters. */
    get size(): number;
    set size(v: number);
    /** Width multiplier (perpendicular to up). */
    get stretchX(): number;
    set stretchX(v: number);
    /** Height multiplier (along up). */
    get stretchY(): number;
    set stretchY(v: number);
    /** Opacity multiplier (0–1). */
    get opacity(): number;
    set opacity(v: number);
    /**
     * Distance (m) below the displaced water surface to anchor the billboard
     * bottom. Each frame, alive particles are re-anchored to
     * `surfaceY − submersionDepth` at their XZ. `0` keeps the bottom right on
     * the surface; small positive values (e.g. `0.1–0.5`) tuck the base of
     * the plume just under the water and hide the seam.
     */
    get submersionDepth(): number;
    set submersionDepth(v: number);
    /**
     * Bottom-fade start (0–1, billboard-vertical). Alpha is fully transparent
     * at and below this height. With `bottomFadeStop`, defines a linear ramp
     * from transparent → opaque used to soften the bottom edge of the plume.
     * Set both to `0` to disable the fade.
     */
    get bottomFadeStart(): number;
    set bottomFadeStart(v: number);
    /**
     * Bottom-fade stop (0–1, billboard-vertical). Alpha is fully opaque at
     * and above this height. See {@link bottomFadeStart}.
     */
    get bottomFadeStop(): number;
    set bottomFadeStop(v: number);
    /** Maximum particle lifetime in seconds. */
    get duration(): number;
    set duration(v: number);
    /**
     * Length of the alpha fade-out tail (s), measured backwards from death.
     * The flipbook completes over `duration − fadeOutTime` (so it always
     * reaches the final frame), then holds that frame while alpha smoothly
     * fades to zero over the last `fadeOutTime` seconds. `0` cuts the plume
     * off instantly when life expires.
     */
    get fadeOutTime(): number;
    set fadeOutTime(v: number);
    /**
     * Minimum relative impact speed (m/s) at the moment of water-line
     * crossing for a probe to fire. Impact speed is the vertical
     * convergence rate between probe and surface over the last frame, so a
     * wave rising onto a stationary probe and a probe falling onto still
     * water both register the same magnitude.
     */
    get velocityThreshold(): number;
    set velocityThreshold(v: number);
    /**
     * Extra cooldown (s) added after a particle's lifetime ends before the
     * probe that triggered it is allowed to fire again. Total per-probe
     * cooldown is `duration + jitter + respawnTime`, so a re-trigger can
     * never overlap a pending or still-playing burst.
     */
    get respawnTime(): number;
    set respawnTime(v: number);
    /**
     * Maximum random delay (s) between trigger and the moment the burst
     * becomes visible. Each trigger picks an independent jitter ∈ [0,
     * spawnJitterTime); the particle is written at the probe's *current*
     * world position when the dwell expires, so a moving boat that
     * travels during the dwell keeps its plume attached to the probe.
     * The cooldown extends to cover the delay so a re-trigger can't
     * overlap. `0` disables — every trigger spawns visibly on the same
     * frame at the crossing position.
     */
    get spawnJitterTime(): number;
    set spawnJitterTime(v: number);
    /**
     * Per-particle uniform scale (both axes) as a function of impact speed
     * at the moment of firing. Sampled at spawn (frozen for the burst's
     * lifetime): `sizeScale = min(1 + velocityScaleFactor × max(0, impactSpeed − velocityThreshold), 2)`.
     * `0` disables.
     */
    get velocityScaleFactor(): number;
    set velocityScaleFactor(v: number);
    /**
     * Per-particle height multiplier as a function of impact speed at the
     * moment of firing. Sampled at spawn (frozen for the burst's lifetime):
     * `heightScale = min(1 + velocityHeightFactor × max(0, impactSpeed − velocityThreshold), 2)`.
     * Applied **on top of** the size scale, so the Y axis ends up scaled by
     * `sizeScale × heightScale`. `0` disables.
     */
    get velocityHeightFactor(): number;
    set velocityHeightFactor(v: number);
    /** @internal Bulk-set parameters from a preset. */
    update(params: SprayParams): void;
    /**
     * Per-frame tick: refresh per-emitter state on the GPU, then dispatch
     * simulate (over the entire pool) followed by emission. No-op when
     * disabled or unallocated.
     *
     * Simulation runs **before** emission so freshly-spawned particles
     * don't take an immediate physics step on their birth frame.
     *
     * @param deltaTime - Substep duration in seconds. Clamped at 50 ms before
     *   reaching the GPU sim so a host stall does not cause a giant integration
     *   step.
     * @param time - Absolute simulation time in seconds, supplied by the owning
     *   {@link WaterSystem}. The spray system does not accumulate its own clock
     *   — driving from a shared time keeps it aligned with the rest of the
     *   simulation under host stalls and across `syncToTick` snaps.
     */
    tick(deltaTime: number, time: number): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=SpraySystem.d.ts.map