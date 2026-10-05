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
import type { IWakeFieldSampler } from "../../simulation/waves/wake";
import { type WakeDebugData, type WakeGenerator, type WakeGeneratorOptions } from "./index";
import type { WaterSubsystem } from "../types";
import type { QualityLevel, QualityLevelConfig } from "../../config/QualityLevels";
import type { WaterSceneConfig } from "../../config/presets/types";
export declare class WakeSystem implements WaterSubsystem {
    /** Registered generators. */
    private generators;
    private nextGeneratorId;
    /** Backend selection, kept for the resolution-rebuild path. */
    private readonly _renderer;
    private readonly _isWebGL;
    /** Camera the field centres its world origin on. Updated via {@link setCamera}. */
    private _camera;
    /** Buffer configuration. */
    private _resolution;
    private _worldSize;
    /** Shared ocean gravity uniform; bound into the wake so dispersion tracks it. */
    private readonly _gravity;
    /** Field-global parameters (one medium for all generators). */
    private _friction;
    private _foamPersistence;
    private _foamStrength;
    private _foamBreakThreshold;
    /** Wake field simulator (WebGPU compute or WebGL render-to-texture iWave). */
    private _simulation;
    private _enabled;
    /** Notified with the new sampler when the field is rebuilt (resolution change). */
    private _onSamplerRebuilt;
    /** Reusable temp objects. */
    private tempForward;
    private _tempRight;
    private _tempQuat;
    private _tempWorldPos;
    constructor(renderer: THREE.WebGPURenderer, isWebGL: boolean, resolution: number, worldSize: number, gravity: Node, camera: THREE.Camera);
    /** Update the camera the field centres on (called when `WaterSystem`'s camera changes). */
    setCamera(camera: THREE.Camera): void;
    /** Build a field simulator for the current resolution/world-size/params. */
    private _createSimulation;
    /** Whether the wake system is active. When false, the field reads as calm water and generators inject nothing. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Displacement field resolution (texels per side). */
    get resolution(): number;
    /** Rebuild the field at a new resolution (disposes + recreates buffers). */
    set resolution(value: number);
    /** Displacement field extent (world units per side). */
    get worldSize(): number;
    set worldSize(value: number);
    /** Velocity-damping friction `γ` (≥ 0). Higher = shorter, more-damped wake trail. */
    get friction(): number;
    set friction(value: number);
    /** Persistent wake-foam decay per frame (closer to 1 = longer-lasting foam trail). */
    get foamPersistence(): number;
    set foamPersistence(value: number);
    /** Wake-foam injection rate at a breaking crest. */
    get foamStrength(): number;
    set foamStrength(value: number);
    /** Surface steepness `|∇h|` at which wake foam begins. */
    get foamBreakThreshold(): number;
    set foamBreakThreshold(value: number);
    /**
     * Rebuild the field at a new resolution. Disposes the current simulator,
     * constructs a new one (re-applying the field-global params), and notifies
     * the sampler-rebuild subscriber so the material re-binds. No-op if unchanged.
     */
    setResolution(value: number): void;
    /**
     * Register a callback invoked with the new sampler whenever the field is
     * rebuilt (e.g. on a resolution change). `WaterSystem` uses this to re-bind
     * the sampler into the surface material.
     */
    onSamplerRebuild(callback: (sampler: IWakeFieldSampler) => void): void;
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
    addGenerator(object: THREE.Object3D, options?: WakeGeneratorOptions): number;
    /**
     * Remove a wake generator.
     *
     * @returns true if removed, false if not found.
     */
    removeGenerator(id: number): boolean;
    /**
     * Shallow-merge new options into a registered generator. Omitted fields keep
     * their current values.
     *
     * @returns true if updated, false if not found.
     */
    updateGenerator(id: number, options: WakeGeneratorOptions): boolean;
    /** Get the number of registered generators. */
    getGeneratorCount(): number;
    /** Get all registered generators. */
    getGenerators(): ReadonlyMap<number, WakeGenerator>;
    /**
     * Per-generator debug snapshot for {@link WakeDebugVisualizer}: each
     * generator's world-space injection point plus its footprint radius and hull
     * depth. Allocates a fresh array each call; intended for debug use only.
     */
    getDebugData(): WakeDebugData[];
    /**
     * Returns the TSL sampler that the water vertex shader reads to add wake
     * displacement. Stable until the field is rebuilt; subscribe via
     * {@link onSamplerRebuild} to be re-handed the sampler on rebuild.
     */
    getSampler(): IWakeFieldSampler;
    /**
     * Advance the wake one simulation step ({@link WaterSubsystem.step}).
     *
     * Computes the camera-anchored origin, injects each active generator's swept
     * path, then advances the wave field one step. No-op while disabled.
     *
     * @param deltaTime - Time since the last substep in seconds.
     */
    step(deltaTime: number): Promise<void>;
    /**
     * Walk every active generator, compute its per-frame world-position delta,
     * and inject a velocity impulse along the swept path. Stationary objects
     * inject nothing; deltas above `teleportThreshold` are treated as a teleport
     * (skipped injection, `lastWorldPos` resync). The first call per generator
     * only captures the starting position.
     */
    private _injectFromGenerators;
    /**
     * Apply a scene preset's wake field params ({@link WaterSubsystem.applyParams}).
     * Reads only the foam and friction slice — enablement, resolution, and extent
     * are quality-tier-owned (see {@link onQualityChanged}), not preset-driven.
     */
    applyParams(params: WaterSceneConfig): void;
    /**
     * Apply the quality level's wake field config ({@link WaterSubsystem.onQualityChanged}).
     * Enablement, resolution, and extent are all quality-scaled (low disables the
     * solve entirely). Each is guarded so a switch within the same tier does
     * nothing — only a real change re-derives the field, and a resolution change
     * rebuilds it and re-binds the sampler into the surface material.
     */
    onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void;
    /** Dispose of all resources owned by the wake system. */
    dispose(): void;
    /**
     * Resolve a generator's world-space injection point: the object's world
     * position shifted to the local-frame `offset` (bow/stern). The offset basis
     * is flattened to the XZ plane so hull pitch and roll don't slide the point as
     * the hull bobs — only yaw matters for a 2D wake field. Writes into `out`.
     */
    private _resolveInjectionPoint;
    /** Fold user-supplied options onto {@link DEFAULT_WAKE_GENERATOR_OPTIONS}. */
    private _resolveOptions;
}
//# sourceMappingURL=WakeSystem.d.ts.map