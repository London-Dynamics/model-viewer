import * as THREE from "three/webgpu";
import type { IWakeSimulation, InjectAlongPathParams, WakeSimulationParams } from "../IWakeSimulation";
import type { IWakeFieldSampler } from "../IWakeFieldSampler";
/**
 * WebGL dispersive wake simulator (Tessendorf's iWave).
 *
 * The render-to-texture sibling of {@link WebGPUWakeSimulation}: the same height
 * grid advanced by a `√(−∇²)` convolution + explicit leapfrog, but state lives in
 * float render targets and the update runs as two fragment passes (a horizontal
 * convolution into a scratch target, then a vertical convolution folded into the
 * leapfrog) drawn over a full-screen quad.
 *
 * The leapfrog needs `h_t` and `h_{t−1}`; on a camera-shifting grid a cell reads
 * neighbours at shifted coordinates, so the destination must not alias a target
 * being read — hence **three** rotating state targets (prev/cur/next all
 * distinct). Each texel packs `(height, foam)` into the RG channels; the scratch
 * target packs the rank-2 partial sums into RG. A single horizontal and a single
 * leapfrog material serve all phases — the texture nodes are re-pointed at the
 * current/previous/scratch targets each step.
 */
export declare class WebGLWakeSimulation implements IWakeSimulation {
    private readonly _params;
    private readonly _renderer;
    /** Rotating state targets (prev/cur/next), each RG = (height, foam). */
    private _state;
    /** Transient rank-2 horizontal-convolution scratch (RG); rewritten each step. */
    private _scratch;
    private _materials;
    private _horizontal;
    private _leapfrog;
    private _clearMaterial;
    private readonly _quad;
    /** Sampler-bound displacement node; re-pointed at the freshly written target each step. */
    private _displacementTextureNode;
    private _sampler;
    /** Rotation phase in [0,3); selects the current/previous/destination targets. */
    private _phase;
    private _prevOriginX;
    private _prevOriginZ;
    /** Previous frame's integer texel shift; the prev leapfrog level needs `shift + this`. */
    private _lastShiftX;
    private _lastShiftZ;
    private _firstFrame;
    /** When set, the next step zeroes the field (stored content is invalid). */
    private _pendingReset;
    /** Sleeps the solver while every persistent field target is known to be zero. */
    private _solverSleeping;
    /** Generators written this frame; consumed and reset by {@link step}. */
    private _genWriteIndex;
    constructor(params: WakeSimulationParams, renderer: THREE.WebGPURenderer);
    getSampler(): IWakeFieldSampler;
    setFriction(value: number): void;
    setFoamPersistence(value: number): void;
    setFoamStrength(value: number): void;
    setFoamBreakThreshold(value: number): void;
    setWorldSize(value: number): void;
    injectAlongPath(params: InjectAlongPathParams): void;
    reset(): void;
    step(dt: number, originX: number, originZ: number): Promise<void>;
    dispose(): void;
    /**
     * Float RG state target. `NearestFilter` so the convolution and the sampler
     * read exact texels; clamp-to-edge so out-of-range reads hold the border (the
     * sponge keeps it near zero).
     */
    private _createStateTarget;
    /** Material that writes zero before the solver enters sleep. */
    private _buildClearMaterial;
    private _renderToTarget;
    /** Zero every state target and put the solver to sleep. */
    private _clearFieldAndSleep;
    /** Re-anchor the field while the solver sleeps. */
    private _anchorSleepingField;
}
//# sourceMappingURL=WebGLWakeSimulation.d.ts.map