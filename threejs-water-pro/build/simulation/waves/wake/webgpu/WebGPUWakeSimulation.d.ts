import * as THREE from "three/webgpu";
import type { IWakeSimulation, InjectAlongPathParams, WakeSimulationParams } from "../IWakeSimulation";
import type { IWakeFieldSampler } from "../IWakeFieldSampler";
/**
 * WebGPU dispersive wake simulator (Tessendorf's iWave).
 *
 * A height grid advanced by a `√(−∇²)` convolution + explicit leapfrog, giving
 * deep-water dispersion. The convolution is a rank-2 separable approximation of
 * the kernel run as two 1D passes per step (a horizontal pass into a vec2
 * scratch buffer, then a vertical pass folded into the leapfrog; see
 * {@link WakeIWaveCompute}).
 *
 * The leapfrog needs `h_t` and `h_{t−1}`; on a camera-shifting grid a cell reads
 * neighbours at shifted coordinates, so the destination must not alias a buffer
 * being read — hence **three** rotating height buffers (prev/cur/next all
 * distinct) plus three foam buffers in lockstep. One horizontal + one leapfrog
 * variant per rotation phase is dispatched in a 3-cycle; the scratch buffer is
 * transient (rewritten each step) and shared across phases.
 */
export declare class WebGPUWakeSimulation implements IWakeSimulation {
    private readonly _params;
    private readonly _renderer;
    /** Rotating height levels (prev/cur/next) and foam (decay+inject) buffers. */
    private _height;
    private _foam;
    /** Transient rank-2 horizontal-convolution scratch (vec2); rewritten each step. */
    private _scratch;
    /** Stable displacement output: vec2(height, foam). */
    private _displacement;
    private _compute;
    /** Horizontal-convolution pass per rotation phase (reads height level `phase`). */
    private _horizontal;
    /** Vertical-convolution + leapfrog pass per phase: (cur, prev, dst) = (0,2,1), (1,0,2), (2,1,0). */
    private _leapfrog;
    private _sampler;
    /** Rotation phase in [0,3); selects the variant and buffer roles. */
    private _phase;
    private _prevOriginX;
    private _prevOriginZ;
    /** Previous frame's integer texel shift; the prev leapfrog level needs `shift + this`. */
    private _lastShiftX;
    private _lastShiftZ;
    private _firstFrame;
    /** When set, the next step zeroes the field (stored content is invalid). */
    private _pendingReset;
    /** Sleeps the solver while every persistent field buffer is known to be zero. */
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
    /** Zero every field buffer and put the solver to sleep. */
    private _clearFieldAndSleep;
    /** Re-anchor the field while the solver sleeps. */
    private _anchorSleepingField;
    dispose(): void;
}
//# sourceMappingURL=WebGPUWakeSimulation.d.ts.map