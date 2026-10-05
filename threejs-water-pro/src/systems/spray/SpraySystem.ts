// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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
import { storage, uniform } from "three/tsl";
import type { IWaveSimulation } from "../../simulation/waves";
import { WebGPUWaveSimulation } from "../../simulation/waves/webgpu";
import type { WaterSurfaceMaterial } from "../../components/surface/WaterSurfaceMaterial";
import type { CascadeSampler } from "../../shaders/cascadeSampler";
import type { UniformFloatNode } from "../../shaders/types";
import {
  DEFAULT_EMITTER_PARAMS,
  EmitterRegistry,
  EMISSION_THREADS,
  MAX_EMITTERS,
  MAX_PROBES_PER_EMITTER,
  type AddEmitterOptions,
  type EmitterParams,
} from "./EmitterRegistry";
import { createEmissionCompute } from "./shaders/emission";
import { createSimulateCompute } from "./shaders/simulate";
import { buildDropletShader } from "./shaders/droplet";
import { createSprayTexture, SPRAY_VARIANT_COUNT } from "./sprayTexture";

// Re-export emitter option types so callers can import them from the same
// barrel they import `SpraySystem` from.
export type {
  AddEmitterOptions,
  EmitterParams,
  ProbeDebugSnapshot,
  SprayProbe,
} from "./EmitterRegistry";
export {
  DEFAULT_EMITTER_PARAMS,
  MAX_EMITTERS,
  MAX_PROBES_PER_EMITTER,
} from "./EmitterRegistry";

// ============================================
// Types
// ============================================

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

// ============================================
// Constants
// ============================================

/**
 * Floats per particle. Four vec4 slots:
 *   slot0 = (posX, posY, posZ, lifeRemaining)
 *   slot1 = (sizeScale, heightScale, variantIdx, birthLife)
 *   slot2 = (size, stretchX, stretchY, opacity)              ← spawn-baked
 *   slot3 = (bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)
 */
const PARTICLE_STRIDE_FLOATS = 16;
const PARTICLE_VEC4_COUNT = 4;

// ============================================
// SpraySystem
// ============================================

export class SpraySystem {
  /**
   * Construct a SpraySystem if the active backend supports the GPU
   * compute pipeline it requires. Returns `null` on WebGL or when the
   * material's cascade sampler isn't available — the caller should treat
   * a `null` return as "spray unavailable on this backend" and continue.
   *
   * @param maxParticles - Pool budget. `0` keeps the system inert
   *   (allocated nothing, no compute, no render).
   */
  static tryCreate(
    renderer: THREE.WebGPURenderer,
    oceanSim: IWaveSimulation,
    material: WaterSurfaceMaterial,
    maxParticles: number,
    maskEnabled: UniformFloatNode,
  ): SpraySystem | null {
    if (!(oceanSim instanceof WebGPUWaveSimulation)) return null;
    if (!material.cascadeSampler) return null;
    return new SpraySystem(
      renderer,
      oceanSim,
      material.cascadeSampler,
      maxParticles,
      maskEnabled,
    );
  }

  // ── Dependencies ────────────────────────────────────────
  private _renderer: THREE.WebGPURenderer;
  private _oceanSim: WebGPUWaveSimulation;
  private _cascadeSampler: CascadeSampler;

  // ── Pool configuration ──────────────────────────────────
  // One particle slot per probe thread — a probe holds at most one alive
  // particle at a time. Pool size is fixed at EMISSION_THREADS when spray
  // is enabled; the constructor's `maxCount` argument is treated as a
  // boolean (`> 0` means allocate).
  private _maxCount: number;

  // ── GPU particle pool ───────────────────────────────────
  private _particleBuffer: THREE.StorageInstancedBufferAttribute | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _particleBufferNode: any = null;

  // ── Emitter registry (owns probe + state + params buffers) ─────
  private _registry: EmitterRegistry | null = null;

  // ── Render mesh ─────────────────────────────────────────
  private _mesh: THREE.Object3D;
  private _geometry: THREE.InstancedBufferGeometry | null = null;
  private _material: THREE.MeshBasicNodeMaterial | null = null;

  // ── State ───────────────────────────────────────────────
  private _enabled = false;

  /**
   * Default per-emitter params. Setters write here and broadcast to every
   * registered emitter; `addEmitter` merges with overrides to produce
   * each emitter's initial params; `updateEmitter` only patches the
   * emitter, not these defaults.
   */
  private _defaults: EmitterParams = { ...DEFAULT_EMITTER_PARAMS };

  // ── Global uniforms (truly system-wide) ─────────────────
  private _meanY = uniform(0.0);
  private _deltaTime = uniform(0.016);
  private _time = uniform(0.0);

  // ── Spray blob texture (static, generated procedurally) ─
  private _sprayTexture: THREE.DataArrayTexture = createSprayTexture();

  // ── Screen-space mask wiring (refreshed by RenderPassManager) ──
  // Default 1×1 black texture (R=0 ⇒ no mask anywhere) until the real
  // mask render-target texture arrives via `setMaskTexture`. Held in a
  // dedicated field so dispose() can release it without touching the
  // externally-owned mask render target.
  private _defaultMaskTexture: THREE.DataTexture = new THREE.DataTexture(
    new Float32Array([0, 0, 0, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  private _maskTexture: THREE.Texture = this._defaultMaskTexture;
  private _maskEnabled: UniformFloatNode;

  // ── Compute passes ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _emissionCompute: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _simulateCompute: any = null;

  private constructor(
    renderer: THREE.WebGPURenderer,
    oceanSim: WebGPUWaveSimulation,
    cascadeSampler: CascadeSampler,
    maxCount: number,
    maskEnabled: UniformFloatNode,
  ) {
    this._renderer = renderer;
    this._oceanSim = oceanSim;
    this._cascadeSampler = cascadeSampler;
    this._maskEnabled = maskEnabled;

    // One particle slot per probe thread. The `maxCount` argument is a
    // boolean: `> 0` allocates the fixed pool, `0` keeps the system inert.
    this._maxCount = maxCount > 0 ? EMISSION_THREADS : 0;

    if (this._maxCount > 0) {
      this._allocatePool();
      this._registry = new EmitterRegistry();
      this._buildComputePasses();
      this._buildRenderMesh();
      this._mesh =
        this._geometry && this._material
          ? new THREE.Mesh(this._geometry, this._material)
          : new THREE.Group();
    } else {
      this._mesh = new THREE.Group();
    }
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
  }

  // ============================================
  // Construction helpers
  // ============================================

  private _allocatePool(): void {
    this._particleBuffer = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(this._maxCount * PARTICLE_STRIDE_FLOATS),
      4,
    );
    this._particleBufferNode = storage(
      this._particleBuffer,
      "vec4",
      this._maxCount * PARTICLE_VEC4_COUNT,
    );
  }

  private _buildComputePasses(): void {
    if (!this._particleBufferNode || !this._registry) return;

    const displacementBuffers = Array.from(
      { length: this._cascadeSampler.cascadeCount },
      (_, i) => this._oceanSim.getDisplacementBuffer(i),
    );
    if (!displacementBuffers[0]) return;

    this._emissionCompute = createEmissionCompute({
      cascadeSampler: this._cascadeSampler,
      deltaTime: this._deltaTime,
      displacementBuffers,
      maxEmitters: MAX_EMITTERS,
      maxProbesPerEmitter: MAX_PROBES_PER_EMITTER,
      meanY: this._meanY,
      particleBuffer: this._particleBufferNode,
      probeBuffer: this._registry.probeBufferNode,
      stateBuffer: this._registry.stateBufferNode,
      time: this._time,
      variantCount: SPRAY_VARIANT_COUNT,
    });

    this._simulateCompute = createSimulateCompute({
      cascadeSampler: this._cascadeSampler,
      deltaTime: this._deltaTime,
      displacementBuffers,
      maxCount: this._maxCount,
      meanY: this._meanY,
      particleBuffer: this._particleBufferNode,
    });
  }

  private _buildRenderMesh(): void {
    if (!this._particleBufferNode) return;

    const base = new THREE.PlaneGeometry(1, 1);
    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.index = base.index;
    this._geometry.attributes.position = base.attributes.position;
    this._geometry.attributes.uv = base.attributes.uv;
    base.dispose();
    this._geometry.instanceCount = this._maxCount;

    this._material = new THREE.MeshBasicNodeMaterial();
    this._material.transparent = true;
    this._material.depthWrite = false;
    this._material.side = THREE.DoubleSide;
    this._assignShaderNodes();
  }

  /**
   * Build the droplet TSL graph and assign it to the material. Called
   * once at construction and again whenever a bound texture reference
   * changes (e.g., the mask render target after a resize).
   */
  private _assignShaderNodes(): void {
    if (!this._particleBufferNode || !this._material) return;

    const { positionNode, colorNode, opacityNode } = buildDropletShader({
      maskEnabled: this._maskEnabled,
      maskTexture: this._maskTexture,
      particleBuffer: this._particleBufferNode,
      sprayTexture: this._sprayTexture,
    });

    this._material.positionNode = positionNode;
    this._material.colorNode = colorNode;
    this._material.opacityNode = opacityNode;
    this._material.needsUpdate = true;
  }

  /** Build a fully-resolved EmitterParams from defaults + override fields. */
  private _resolveEmitterParams(
    overrides: Partial<EmitterParams>,
  ): EmitterParams {
    const params: EmitterParams = { ...this._defaults };
    for (const key of Object.keys(DEFAULT_EMITTER_PARAMS) as Array<
      keyof EmitterParams
    >) {
      const v = overrides[key];
      if (v !== undefined) params[key] = v;
    }
    return params;
  }

  // ============================================
  // Public — emitter API
  // ============================================

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
  addEmitter(object: THREE.Object3D, options: AddEmitterOptions): number {
    if (!this._registry) return -1;
    return this._registry.add(object, {
      active: options.active,
      params: this._resolveEmitterParams(options),
      probes: options.probes,
    });
  }

  /** Remove a previously registered emitter. Returns true if found. */
  removeEmitter(id: number): boolean {
    if (!this._registry) return false;
    return this._registry.remove(id);
  }

  /**
   * Update a registered emitter's tunable parameters. Any
   * {@link EmitterParams} field plus `active` may be patched; `probes`
   * are baked at registration and can't be modified — remove and re-add
   * the emitter to change them, or use {@link setProbeEnabled} to toggle
   * individual probes.
   */
  updateEmitter(id: number, options: Partial<AddEmitterOptions>): boolean {
    if (!this._registry) return false;
    return this._registry.update(id, options);
  }

  /**
   * Toggle a single authored probe on/off. Disabling clears the probe's
   * runtime state so re-enabling never inherits a stale crossing edge or
   * a stuck pending burst. Returns true if the emitter + probeIndex
   * resolve to an authored probe.
   */
  setProbeEnabled(
    emitterId: number,
    probeIndex: number,
    enabled: boolean,
  ): boolean {
    if (!this._registry) return false;
    return this._registry.setProbeEnabled(emitterId, probeIndex, enabled);
  }

  /**
   * Snapshot all registered probes' current debug state. Use with
   * `SprayDebugVisualizer` (in the demo) or any caller that wants to
   * inspect probe positions, directions, velocities, and approximate
   * firing state.
   *
   * Returns an empty array when the system is unallocated. Allocates
   * fresh `Vector3`s — debug-path only, not perf-critical.
   */
  getProbeDebugData(): import("./EmitterRegistry").ProbeDebugSnapshot[] {
    if (!this._registry) return [];
    return this._registry.getDebugData(
      this._meanY.value,
      this._time.value,
      this._deltaTime.value,
    );
  }

  /**
   * @internal
   * Bind the screen-space mask texture from the water mask pass.
   * Called by `RenderPassManager` at construction and on resize, when the
   * underlying render target is recreated and the previous reference is
   * invalidated. Discards spray fragments behind any registered mask
   * object (e.g., the boat hull) so plumes don't visibly cut through
   * geometry.
   */
  setMaskTexture(maskTexture: THREE.Texture): void {
    this._maskTexture = maskTexture;
    this._assignShaderNodes();
  }

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
  setOceanSim(oceanSim: IWaveSimulation, cascadeSampler: CascadeSampler): void {
    if (this._maxCount === 0) return;
    if (!(oceanSim instanceof WebGPUWaveSimulation)) return;

    this._oceanSim = oceanSim;
    this._cascadeSampler = cascadeSampler;
    this._buildComputePasses();
  }

  // ============================================
  // Public — getters / setters
  // ============================================

  /** @internal Scene object for the spray renderer. Add to the scene once. */
  getMesh(): THREE.Object3D {
    return this._mesh;
  }

  /** Whether spray is enabled. Disabled spray skips all compute dispatches. */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    this._mesh.visible = value && this._particleBuffer !== null;
  }

  /** Maximum particles allocated in the pool (read-only, quality-driven). */
  get maxCount(): number {
    return this._maxCount;
  }

  // The setters below are **broadcasters** — each writes the default and
  // pushes the new value into every registered emitter's params slot.
  // Per-emitter overrides set via `addEmitter` / `updateEmitter` are
  // therefore overwritten by a subsequent setter call. Live changes only
  // affect *future* bursts; alive particles keep their spawn-frozen
  // values.

  /** Base billboard side length in meters. */
  get size(): number { return this._defaults.size; }
  set size(v: number) {
    this._defaults.size = v;
    this._registry?.broadcastParams({ size: v });
  }

  /** Width multiplier (perpendicular to up). */
  get stretchX(): number { return this._defaults.stretchX; }
  set stretchX(v: number) {
    this._defaults.stretchX = v;
    this._registry?.broadcastParams({ stretchX: v });
  }

  /** Height multiplier (along up). */
  get stretchY(): number { return this._defaults.stretchY; }
  set stretchY(v: number) {
    this._defaults.stretchY = v;
    this._registry?.broadcastParams({ stretchY: v });
  }

  /** Opacity multiplier (0–1). */
  get opacity(): number { return this._defaults.opacity; }
  set opacity(v: number) {
    this._defaults.opacity = v;
    this._registry?.broadcastParams({ opacity: v });
  }

  /**
   * Distance (m) below the displaced water surface to anchor the billboard
   * bottom. Each frame, alive particles are re-anchored to
   * `surfaceY − submersionDepth` at their XZ. `0` keeps the bottom right on
   * the surface; small positive values (e.g. `0.1–0.5`) tuck the base of
   * the plume just under the water and hide the seam.
   */
  get submersionDepth(): number { return this._defaults.submersionDepth; }
  set submersionDepth(v: number) {
    this._defaults.submersionDepth = v;
    this._registry?.broadcastParams({ submersionDepth: v });
  }

  /**
   * Bottom-fade start (0–1, billboard-vertical). Alpha is fully transparent
   * at and below this height. With `bottomFadeStop`, defines a linear ramp
   * from transparent → opaque used to soften the bottom edge of the plume.
   * Set both to `0` to disable the fade.
   */
  get bottomFadeStart(): number { return this._defaults.bottomFadeStart; }
  set bottomFadeStart(v: number) {
    this._defaults.bottomFadeStart = v;
    this._registry?.broadcastParams({ bottomFadeStart: v });
  }

  /**
   * Bottom-fade stop (0–1, billboard-vertical). Alpha is fully opaque at
   * and above this height. See {@link bottomFadeStart}.
   */
  get bottomFadeStop(): number { return this._defaults.bottomFadeStop; }
  set bottomFadeStop(v: number) {
    this._defaults.bottomFadeStop = v;
    this._registry?.broadcastParams({ bottomFadeStop: v });
  }

  /** Maximum particle lifetime in seconds. */
  get duration(): number { return this._defaults.duration; }
  set duration(v: number) {
    this._defaults.duration = v;
    this._registry?.broadcastParams({ duration: v });
  }

  /**
   * Length of the alpha fade-out tail (s), measured backwards from death.
   * The flipbook completes over `duration − fadeOutTime` (so it always
   * reaches the final frame), then holds that frame while alpha smoothly
   * fades to zero over the last `fadeOutTime` seconds. `0` cuts the plume
   * off instantly when life expires.
   */
  get fadeOutTime(): number { return this._defaults.fadeOutTime; }
  set fadeOutTime(v: number) {
    this._defaults.fadeOutTime = v;
    this._registry?.broadcastParams({ fadeOutTime: v });
  }

  /**
   * Minimum relative impact speed (m/s) at the moment of water-line
   * crossing for a probe to fire. Impact speed is the vertical
   * convergence rate between probe and surface over the last frame, so a
   * wave rising onto a stationary probe and a probe falling onto still
   * water both register the same magnitude.
   */
  get velocityThreshold(): number { return this._defaults.velocityThreshold; }
  set velocityThreshold(v: number) {
    this._defaults.velocityThreshold = v;
    this._registry?.broadcastParams({ velocityThreshold: v });
  }

  /**
   * Extra cooldown (s) added after a particle's lifetime ends before the
   * probe that triggered it is allowed to fire again. Total per-probe
   * cooldown is `duration + jitter + respawnTime`, so a re-trigger can
   * never overlap a pending or still-playing burst.
   */
  get respawnTime(): number { return this._defaults.respawnTime; }
  set respawnTime(v: number) {
    this._defaults.respawnTime = v;
    this._registry?.broadcastParams({ respawnTime: v });
  }

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
  get spawnJitterTime(): number { return this._defaults.spawnJitterTime; }
  set spawnJitterTime(v: number) {
    this._defaults.spawnJitterTime = v;
    this._registry?.broadcastParams({ spawnJitterTime: v });
  }

  /**
   * Per-particle uniform scale (both axes) as a function of impact speed
   * at the moment of firing. Sampled at spawn (frozen for the burst's
   * lifetime): `sizeScale = min(1 + velocityScaleFactor × max(0, impactSpeed − velocityThreshold), 2)`.
   * `0` disables.
   */
  get velocityScaleFactor(): number { return this._defaults.velocityScaleFactor; }
  set velocityScaleFactor(v: number) {
    this._defaults.velocityScaleFactor = v;
    this._registry?.broadcastParams({ velocityScaleFactor: v });
  }

  /**
   * Per-particle height multiplier as a function of impact speed at the
   * moment of firing. Sampled at spawn (frozen for the burst's lifetime):
   * `heightScale = min(1 + velocityHeightFactor × max(0, impactSpeed − velocityThreshold), 2)`.
   * Applied **on top of** the size scale, so the Y axis ends up scaled by
   * `sizeScale × heightScale`. `0` disables.
   */
  get velocityHeightFactor(): number { return this._defaults.velocityHeightFactor; }
  set velocityHeightFactor(v: number) {
    this._defaults.velocityHeightFactor = v;
    this._registry?.broadcastParams({ velocityHeightFactor: v });
  }

  /** @internal Bulk-set parameters from a preset. */
  update(params: SprayParams): void {
    this.enabled = params.enabled;
    const { enabled: _e, ...emitterParams } = params;
    Object.assign(this._defaults, emitterParams);
    this._registry?.broadcastParams(emitterParams);
  }

  // ============================================
  // Per-frame
  // ============================================

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
  async tick(deltaTime: number, time: number): Promise<void> {
    if (
      !this._enabled ||
      !this._emissionCompute ||
      !this._simulateCompute ||
      !this._registry
    ) {
      return;
    }

    this._deltaTime.value = Math.min(deltaTime, 0.05);
    this._time.value = time;

    this._registry.prepareFrame(deltaTime);

    await this._renderer.computeAsync(this._simulateCompute);
    await this._renderer.computeAsync(this._emissionCompute);
  }

  // ============================================
  // Disposal
  // ============================================

  dispose(): void {
    this._registry?.dispose();
    this._registry = null;
    this._geometry?.dispose();
    this._material?.dispose();
    this._sprayTexture.dispose();
    this._defaultMaskTexture.dispose();
    this._geometry = null;
    this._material = null;
    this._particleBuffer = null;
    this._particleBufferNode = null;
    this._emissionCompute = null;
    this._simulateCompute = null;
  }
}
