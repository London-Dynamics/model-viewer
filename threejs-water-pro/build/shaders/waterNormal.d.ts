import type { Node } from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import type { CascadeSampler } from "./cascadeSampler";
export interface BuildWaterSurfaceNormalParams {
    oceanSim: IWaveSimulation;
    /** CascadeSampler instance for WebGPU path. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /** Grid-reference world X coordinate at the fragment (FFT is grid-anchored). */
    fragWorldX: Node;
    /** Grid-reference world Z coordinate at the fragment (FFT is grid-anchored). */
    fragWorldZ: Node;
    /** True (choppy-displaced) world X for sampling the world-anchored wake field. */
    wakeWorldX: Node;
    /** True (choppy-displaced) world Z for sampling the world-anchored wake field. */
    wakeWorldZ: Node;
    /** Hierarchical cascade sample coordinates from the vertex stage, one per cascade after the first. */
    vHierarchicalCoords: Node[];
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
    /** Per-drop rain ripple splash factor. Null if rain ripples are disabled. */
    rippleSplash: Node | null;
    /**
     * Sub-footprint slope variance (0-1) from the cascade normal mips, driving
     * the filtered-BRDF reflection roughness. Zero on the WebGL noise path.
     */
    slopeVariance: Node;
}
/**
 * Builds the wave-displaced surface normal.
 *
 * Identical to the inline computation previously in `waterFragment.ts` so
 * the SSR G-buffer pass produces a `reflectDir` that matches the main pass.
 */
export declare function buildWaterSurfaceNormal(params: BuildWaterSurfaceNormalParams): BuildWaterSurfaceNormalResult;
//# sourceMappingURL=waterNormal.d.ts.map