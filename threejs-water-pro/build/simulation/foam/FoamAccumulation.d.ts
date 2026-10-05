/**
 * World-fixed wave-crest foam accumulation.
 *
 * One camera-anchored half-float render-target ping-pong advanced by a single
 * fragment pass, on both backends (foam has no spatial coupling, so a fragment
 * pass is equivalent to a compute pass and lets the GPU's texture units do the
 * cascade-normal bilinear for free). Each texel maps to a world position; the
 * inject samples the FFT cascade normal textures there, sums the foldings
 * before the breaking threshold, and accumulates with decay against the
 * previous energy read at the camera-shifted UV. The sampler reads the
 * freshly written target.
 */
import * as THREE from "three/webgpu";
import type { IWaveSimulation } from "../waves";
import type { UniformFloatNode } from "../../types/tsl";
import type { WaveUniforms } from "../../uniforms";
import type { FoamPersistence } from "../../shaders/foamPersistence";
import type { WaterSubsystem } from "../../systems/types";
import type { QualityLevel, QualityLevelConfig } from "../../config/QualityLevels";
import type { IFoamFieldSampler } from "./IFoamFieldSampler";
/** Construction parameters for the world-fixed foam field. */
export interface FoamAccumulationConfig {
    /**
     * Shared persistence uniforms (owned by `WaveFoam`). The inject pass binds
     * these nodes by reference, so `water.foam.waves.persistence` drives the field.
     */
    persistence: FoamPersistence;
    /**
     * Wave-foam enable node (owned by `WaveFoam`). Read CPU-side each step: while
     * it reads 0 the field skips its update; the same node gates the shading, so
     * stale energy is never drawn. Re-enabling clears the field before injecting.
     */
    enabledNode: UniformFloatNode;
    /** Field resolution in texels per side. */
    resolution: number;
    /** Field extent in world units per side (the camera-anchored window). */
    worldSize: number;
}
export declare class FoamAccumulation implements WaterSubsystem {
    private readonly _renderer;
    private _oceanSim;
    private readonly _waveUniforms;
    private _uniforms;
    private _resolution;
    private readonly _enabledNode;
    private _wasEnabled;
    private _camera;
    private readonly _forwardScratch;
    private _originX;
    private _originZ;
    private _worldSizeNode;
    private _shiftX;
    private _shiftZ;
    /** Ping-pong energy targets; `.r` holds the foam energy. */
    private _targets;
    /** Index of the target holding the latest energy. */
    private _current;
    private _material;
    private _clearMaterial;
    private readonly _quad;
    private _sampler;
    private _onSamplerRebuilt;
    private _prevOriginX;
    private _prevOriginZ;
    private _firstFrame;
    private _pendingReset;
    constructor(renderer: THREE.WebGPURenderer, oceanSim: IWaveSimulation, waveUniforms: WaveUniforms, config: FoamAccumulationConfig);
    private _buildField;
    /**
     * Build the inject material against the current wave sim's cascade normal
     * textures. Separated from {@link _buildField} so a wave sim swap
     * ({@link setOceanSim}) rebinds the injection without disturbing the
     * targets, sampler, or anchor state.
     */
    private _buildMaterial;
    getSampler(): IFoamFieldSampler;
    onSamplerRebuild(callback: (sampler: IFoamFieldSampler) => void): void;
    /** Set the camera the field anchors on (mirrors the wake). */
    setCamera(camera: THREE.Camera): void;
    /**
     * Rebind the injection to a new wave simulation. Only the inject material
     * depends on the sim (its cascade normal textures); the targets and
     * sampler read the field's own targets, so a quality switch rebinds here
     * without rebuilding the field or re-handing the sampler.
     */
    setOceanSim(oceanSim: IWaveSimulation): void;
    get resolution(): number;
    set resolution(value: number);
    get worldSize(): number;
    set worldSize(value: number);
    /**
     * Apply the quality level's foam-field config
     * ({@link WaterSubsystem.onQualityChanged}): world extent and resolution. Each
     * is guarded so a switch within the same tier is a no-op; a resolution change
     * rebuilds the field and re-binds the sampler into the surface material.
     * Enablement is quality-defaulted alongside the foam shading, not here.
     */
    onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void;
    step(deltaTime: number, _gpuTime: number): Promise<void>;
    dispose(): void;
    private _createTarget;
    private _buildClearMaterial;
    private _renderToTarget;
    private _clearTargets;
}
//# sourceMappingURL=FoamAccumulation.d.ts.map