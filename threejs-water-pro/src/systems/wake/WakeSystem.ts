// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * WakeSystem — wake displacement orchestrator.
 *
 * Owns the generator registry, camera-anchored world-origin bookkeeping, and
 * the dispersive wake field simulator (Tessendorf's iWave: a `√(−∇²)`
 * convolution + leapfrog on a height grid, giving deep-water dispersion). The
 * backend (WebGPU compute or WebGL render-to-texture) is chosen by the factory
 * at construction; both satisfy {@link IWakeSimulation}.
 *
 * Per frame: every active generator adds a moving source along the path its
 * parent `Object3D` swept since the previous frame. The field then radiates and
 * fades that disturbance — long waves outrunning short (a Kelvin-shaped wake) —
 * and the water vertex shader reads the result as an additive term next to the
 * FFT displacement.
 */
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { createWakeSimulation } from "../../simulation/waves/wake";
import type {
  IWakeFieldSampler,
  IWakeSimulation,
} from "../../simulation/waves/wake";
import { decideInjectionForFrame } from "../../simulation/waves/wake";
import {
  DEFAULT_WAKE_GENERATOR_OPTIONS,
  type WakeDebugData,
  type WakeGenerator,
  type WakeGeneratorInjectionOptions,
  type WakeGeneratorOptions,
} from "./index";
import type { WaterSubsystem } from "../types";
import type {
  QualityLevel,
  QualityLevelConfig,
} from "../../config/QualityLevels";
import type { WaterSceneConfig } from "../../config/presets/types";
import { viewCenterOnWater } from "../../utils/viewCenterOnWater";

/**
 * Maximum generators injecting in a single frame (sizes a fixed uniform array;
 * the per-texel kernel loop gates inactive slots behind `genCount`, so unused
 * slots cost only a branch check). Sized with headroom for a ship plus a
 * handful of buoys.
 */
const MAX_GENERATORS = 16;

export class WakeSystem implements WaterSubsystem {
  /** Registered generators. */
  private generators: Map<number, WakeGenerator> = new Map();
  private nextGeneratorId: number = 0;

  /** Backend selection, kept for the resolution-rebuild path. */
  private readonly _renderer: THREE.WebGPURenderer;
  private readonly _isWebGL: boolean;

  /** Camera the field centres its world origin on. Updated via {@link setCamera}. */
  private _camera: THREE.Camera;

  /** Buffer configuration. */
  private _resolution: number;
  private _worldSize: number;

  /** Shared ocean gravity uniform; bound into the wake so dispersion tracks it. */
  private readonly _gravity: Node;

  /** Field-global parameters (one medium for all generators). */
  // Velocity-damping friction γ. Required for stability (the truncated operator
  // is not positive-definite at the grid scale) and sets the trail length.
  private _friction: number = 0.25;
  // Persistent foam energy (decay+inject), world-anchored on the wake field and
  // rendered through the surface WaveFoam pipeline (same look as crest foam).
  private _foamPersistence: number = 0.99;
  private _foamStrength: number = 1.0;
  private _foamBreakThreshold: number = 0.0;

  /** Wake field simulator (WebGPU compute or WebGL render-to-texture iWave). */
  private _simulation: IWakeSimulation;

  private _enabled: boolean = true;

  /** Notified with the new sampler when the field is rebuilt (resolution change). */
  private _onSamplerRebuilt: ((sampler: IWakeFieldSampler) => void) | null =
    null;

  /** Reusable temp objects. */
  private tempForward = new THREE.Vector3();
  private _tempRight = new THREE.Vector3();
  private _tempQuat = new THREE.Quaternion();
  private _tempWorldPos = new THREE.Vector3();

  constructor(
    renderer: THREE.WebGPURenderer,
    isWebGL: boolean,
    resolution: number,
    worldSize: number,
    gravity: Node,
    camera: THREE.Camera,
  ) {
    this._renderer = renderer;
    this._isWebGL = isWebGL;
    this._resolution = resolution;
    this._worldSize = worldSize;
    this._gravity = gravity;
    this._camera = camera;
    this._simulation = this._createSimulation();
  }

  /** Update the camera the field centres on (called when `WaterSystem`'s camera changes). */
  setCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /** Build a field simulator for the current resolution/world-size/params. */
  private _createSimulation(): IWakeSimulation {
    const sim = createWakeSimulation(
      {
        resolution: this._resolution,
        worldSize: this._worldSize,
        gravity: this._gravity,
        gamma: this._friction,
        maxGenerators: MAX_GENERATORS,
      },
      this._renderer,
      this._isWebGL,
    );
    sim.setFoamPersistence(this._foamPersistence);
    sim.setFoamStrength(this._foamStrength);
    sim.setFoamBreakThreshold(this._foamBreakThreshold);
    return sim;
  }

  // ============================================
  // Configuration
  // ============================================

  /** Whether the wake system is active. When false, the field reads as calm water and generators inject nothing. */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    if (this._enabled === value) return;
    this._enabled = value;
    // Disabling clears the field so it reads as calm water rather than a frozen
    // snapshot of the last wake (the solver no longer steps to decay it).
    if (!value) this._simulation.reset();
  }

  /** Displacement field resolution (texels per side). */
  get resolution(): number {
    return this._resolution;
  }
  /** Rebuild the field at a new resolution (disposes + recreates buffers). */
  set resolution(value: number) {
    this.setResolution(value);
  }

  /** Displacement field extent (world units per side). */
  get worldSize(): number {
    return this._worldSize;
  }
  set worldSize(value: number) {
    this._worldSize = value;
    this._simulation.setWorldSize(value);
  }

  /** Velocity-damping friction `γ` (≥ 0). Higher = shorter, more-damped wake trail. */
  get friction(): number {
    return this._friction;
  }
  set friction(value: number) {
    this._friction = value;
    this._simulation.setFriction(value);
  }

  /** Persistent wake-foam decay per frame (closer to 1 = longer-lasting foam trail). */
  get foamPersistence(): number {
    return this._foamPersistence;
  }
  set foamPersistence(value: number) {
    this._foamPersistence = value;
    this._simulation.setFoamPersistence(value);
  }

  /** Wake-foam injection rate at a breaking crest. */
  get foamStrength(): number {
    return this._foamStrength;
  }
  set foamStrength(value: number) {
    this._foamStrength = value;
    this._simulation.setFoamStrength(value);
  }

  /** Surface steepness `|∇h|` at which wake foam begins. */
  get foamBreakThreshold(): number {
    return this._foamBreakThreshold;
  }
  set foamBreakThreshold(value: number) {
    this._foamBreakThreshold = value;
    this._simulation.setFoamBreakThreshold(value);
  }

  /**
   * Rebuild the field at a new resolution. Disposes the current simulator,
   * constructs a new one (re-applying the field-global params), and notifies
   * the sampler-rebuild subscriber so the material re-binds. No-op if unchanged.
   */
  setResolution(value: number): void {
    if (value === this._resolution) return;
    this._resolution = value;
    this._simulation.dispose();
    this._simulation = this._createSimulation();
    this._onSamplerRebuilt?.(this._simulation.getSampler());
  }

  /**
   * Register a callback invoked with the new sampler whenever the field is
   * rebuilt (e.g. on a resolution change). `WaterSystem` uses this to re-bind
   * the sampler into the surface material.
   */
  onSamplerRebuild(callback: (sampler: IWakeFieldSampler) => void): void {
    this._onSamplerRebuilt = callback;
  }

  // ============================================
  // Generator Management
  // ============================================

  /**
   * Register an object as a wake generator. The object's world position is
   * sampled each frame; the per-frame delta drives injection along the
   * traversed path.
   *
   * @param object - The Three.js object whose world motion drives injection.
   * @param options - Injection parameters. Anything omitted falls back to
   *   {@link DEFAULT_WAKE_GENERATOR_OPTIONS}.
   * @returns Generator ID for later removal/update.
   */
  addGenerator(object: THREE.Object3D, options?: WakeGeneratorOptions): number {
    const id = this.nextGeneratorId++;
    this.generators.set(id, {
      id,
      object,
      active: options?.active ?? true,
      options: this._resolveOptions(options),
      lastWorldPos: new THREE.Vector3(),
      isFirstFrame: true,
    });
    return id;
  }

  /**
   * Remove a wake generator.
   *
   * @returns true if removed, false if not found.
   */
  removeGenerator(id: number): boolean {
    return this.generators.delete(id);
  }

  /**
   * Shallow-merge new options into a registered generator. Omitted fields keep
   * their current values.
   *
   * @returns true if updated, false if not found.
   */
  updateGenerator(id: number, options: WakeGeneratorOptions): boolean {
    const gen = this.generators.get(id);
    if (!gen) return false;
    if (options.active !== undefined) gen.active = options.active;
    if (options.depth !== undefined) gen.options.depth = options.depth;
    if (options.offset !== undefined) gen.options.offset.copy(options.offset);
    if (options.radius !== undefined) gen.options.radius = options.radius;
    if (options.teleportThreshold !== undefined)
      gen.options.teleportThreshold = options.teleportThreshold;
    return true;
  }

  /** Get the number of registered generators. */
  getGeneratorCount(): number {
    return this.generators.size;
  }

  /** Get all registered generators. */
  getGenerators(): ReadonlyMap<number, WakeGenerator> {
    return this.generators;
  }

  /**
   * Per-generator debug snapshot for {@link WakeDebugVisualizer}: each
   * generator's world-space injection point plus its footprint radius and hull
   * depth. Allocates a fresh array each call; intended for debug use only.
   */
  getDebugData(): WakeDebugData[] {
    const data: WakeDebugData[] = [];
    for (const gen of this.generators.values()) {
      const position = new THREE.Vector3();
      this._resolveInjectionPoint(gen, position);
      data.push({
        id: gen.id,
        position,
        radius: gen.options.radius,
        depth: gen.options.depth,
        active: gen.active,
      });
    }
    return data;
  }

  // ============================================
  // Vertex-Shader Interface
  // ============================================

  /**
   * Returns the TSL sampler that the water vertex shader reads to add wake
   * displacement. Stable until the field is rebuilt; subscribe via
   * {@link onSamplerRebuild} to be re-handed the sampler on rebuild.
   */
  getSampler(): IWakeFieldSampler {
    return this._simulation.getSampler();
  }

  // ============================================
  // Per-Frame Update
  // ============================================

  /**
   * Advance the wake one simulation step ({@link WaterSubsystem.step}).
   *
   * Computes the camera-anchored origin, injects each active generator's swept
   * path, then advances the wave field one step. No-op while disabled.
   *
   * @param deltaTime - Time since the last substep in seconds.
   */
  async step(deltaTime: number): Promise<void> {
    if (!this._enabled) return;
    const viewCenter = viewCenterOnWater(
      this._camera,
      this._worldSize * 0.5,
      this.tempForward,
    );
    const texelSize = this._worldSize / this._resolution;
    const originX = Math.round(viewCenter.x / texelSize) * texelSize;
    const originZ = Math.round(viewCenter.z / texelSize) * texelSize;

    this._injectFromGenerators(deltaTime);
    await this._simulation.step(deltaTime, originX, originZ);
  }

  /**
   * Walk every active generator, compute its per-frame world-position delta,
   * and inject a velocity impulse along the swept path. Stationary objects
   * inject nothing; deltas above `teleportThreshold` are treated as a teleport
   * (skipped injection, `lastWorldPos` resync). The first call per generator
   * only captures the starting position.
   */
  private _injectFromGenerators(deltaTime: number): void {
    for (const gen of this.generators.values()) {
      if (!gen.active) continue;
      this._resolveInjectionPoint(gen, this._tempWorldPos);

      const decision = decideInjectionForFrame({
        isFirstFrame: gen.isFirstFrame,
        deltaTime,
        lastWorldPos: { x: gen.lastWorldPos.x, z: gen.lastWorldPos.z },
        newWorldPos: { x: this._tempWorldPos.x, z: this._tempWorldPos.z },
        teleportThreshold: gen.options.teleportThreshold,
      });

      switch (decision.kind) {
        case "first-frame":
          gen.lastWorldPos.copy(this._tempWorldPos);
          gen.isFirstFrame = false;
          break;
        case "teleport":
          gen.lastWorldPos.copy(this._tempWorldPos);
          break;
        case "stationary":
          break;
        case "inject":
          this._simulation.injectAlongPath({
            from: gen.lastWorldPos,
            to: this._tempWorldPos,
            speed: decision.speed,
            depth: gen.options.depth,
            radius: gen.options.radius,
          });
          gen.lastWorldPos.copy(this._tempWorldPos);
          break;
      }
    }
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Apply a scene preset's wake field params ({@link WaterSubsystem.applyParams}).
   * Reads only the foam and friction slice — enablement, resolution, and extent
   * are quality-tier-owned (see {@link onQualityChanged}), not preset-driven.
   */
  applyParams(params: WaterSceneConfig): void {
    this.friction = params.wake.friction;
    this.foamPersistence = params.wake.foamPersistence;
    this.foamStrength = params.wake.foamStrength;
    this.foamBreakThreshold = params.wake.foamBreakThreshold;
  }

  /**
   * Apply the quality level's wake field config ({@link WaterSubsystem.onQualityChanged}).
   * Enablement, resolution, and extent are all quality-scaled (low disables the
   * solve entirely). Each is guarded so a switch within the same tier does
   * nothing — only a real change re-derives the field, and a resolution change
   * rebuilds it and re-binds the sampler into the surface material.
   */
  onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void {
    this.enabled = config.wakeEnabled;
    if (config.wakeWorldSize !== this._worldSize) {
      this.worldSize = config.wakeWorldSize;
    }
    this.setResolution(config.wakeResolution);
  }

  /** Dispose of all resources owned by the wake system. */
  dispose(): void {
    this.generators.clear();
    this._simulation.dispose();
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Resolve a generator's world-space injection point: the object's world
   * position shifted to the local-frame `offset` (bow/stern). The offset basis
   * is flattened to the XZ plane so hull pitch and roll don't slide the point as
   * the hull bobs — only yaw matters for a 2D wake field. Writes into `out`.
   */
  private _resolveInjectionPoint(gen: WakeGenerator, out: THREE.Vector3): void {
    gen.object.getWorldPosition(out);
    const offset = gen.options.offset;
    if (offset.x !== 0 || offset.z !== 0) {
      gen.object.getWorldQuaternion(this._tempQuat);
      this._tempRight.set(1, 0, 0).applyQuaternion(this._tempQuat);
      this.tempForward.set(0, 0, 1).applyQuaternion(this._tempQuat);
      this._tempRight.y = 0;
      this.tempForward.y = 0;
      this._tempRight.normalize();
      this.tempForward.normalize();
      out
        .addScaledVector(this._tempRight, offset.x)
        .addScaledVector(this.tempForward, offset.z);
    }
  }

  /** Fold user-supplied options onto {@link DEFAULT_WAKE_GENERATOR_OPTIONS}. */
  private _resolveOptions(
    options?: WakeGeneratorOptions,
  ): WakeGeneratorInjectionOptions {
    return {
      depth: options?.depth ?? DEFAULT_WAKE_GENERATOR_OPTIONS.depth,
      // Clone so each generator owns its offset vector — never alias the shared
      // default instance.
      offset: options?.offset?.clone() ?? new THREE.Vector3(0, 0, 0),
      radius: options?.radius ?? DEFAULT_WAKE_GENERATOR_OPTIONS.radius,
      teleportThreshold:
        options?.teleportThreshold ??
        DEFAULT_WAKE_GENERATOR_OPTIONS.teleportThreshold,
    };
  }
}
