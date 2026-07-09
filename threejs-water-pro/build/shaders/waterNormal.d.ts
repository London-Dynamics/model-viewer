import type { Node } from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import type { CascadeSampler } from "./cascadeSampler";
export interface BuildWaterSurfaceNormalParams {
    oceanSim: IWaveSimulation;
    /** CascadeSampler instance for WebGPU path. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /** Grid-reference world X coordinate at the fragment (FFT/Gerstner are grid-anchored). */
    fragWorldX: Node;
    /** Grid-reference world Z coordinate at the fragment (FFT/Gerstner are grid-anchored). */
    fragWorldZ: Node;
    /** True (choppy-displaced) world X for sampling the world-anchored wake field. */
    wakeWorldX: Node;
    /** True (choppy-displaced) world Z for sampling the world-anchored wake field. */
    wakeWorldZ: Node;
    /** Hierarchical cascade sample coordinates from the vertex stage. */
    vSampleCoords0: Node;
    /** Vertex-interpolated Gerstner normal. */
    vGerstnerNormal: Node;
    /** Vertex-interpolated Gerstner folding factor. */
    vGerstnerFolding: Node;
    /** Compile-time max number of Gerstner waves (0 disables). */
    gerstnerMaxWaves: number;
    /** Rain ripple simulation, or null if disabled. */
    rainRipples: RainRipples | null;
    /** Wake field sampler for wake normal perturbation, or null if disabled. */
    wakeFieldSampler: IWakeFieldSampler | null;
    /** Camera world position, used by rain ripple distance fade. */
    cameraPosition: Node;
    /**
     * Multiplier applied to ripple splash output. 1.0 for front face, 0.0 for
     * back face. Pass 1.0 from passes that don't distinguish (e.g. G-buffer).
     */
    frontFaceMultiplier: Node;
}
export interface BuildWaterSurfaceNormalResult {
    /** Final surface normal in world space. */
    interpolatedNormal: Node;
    /** Cascade-0 eigenvalue (folding factor) for crest foam. */
    eigen0: Node;
    /** Cascade-1 eigenvalue (folding factor) for crest foam. */
    eigen1: Node;
    /** Per-drop rain ripple splash factor. Null if rain ripples are disabled. */
    rippleSplash: Node | null;
}
/**
 * Builds the wave-displaced surface normal and supporting eigenvalues.
 *
 * Identical to the inline computation previously in `waterFragment.ts` so
 * the SSR G-buffer pass produces a `reflectDir` that matches the main pass.
 */
export declare function buildWaterSurfaceNormal(params: BuildWaterSurfaceNormalParams): BuildWaterSurfaceNormalResult;
//# sourceMappingURL=waterNormal.d.ts.map