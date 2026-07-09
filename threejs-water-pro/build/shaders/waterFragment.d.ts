import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { FoamAccumulation } from "../simulation/foam/FoamAccumulation";
import type { Sky } from "../components/sky/Sky";
import type { SurfaceUniforms } from "../uniforms";
import type { WaterVertexResult } from "./waterVertex";
import type { CascadeSampler } from "./cascadeSampler";
import { type Fresnel } from "./fresnel";
import { type WaterColor } from "./waterColor";
import type { SurfaceFoam } from "./foamSurface";
import type { WaveFoam } from "./foamWaves";
import type { ShorelineFoam } from "./foamShoreline";
import type { Sparkle } from "./sparkle";
import { type SSR } from "./ssr";
import type { SSS } from "./sss";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
export interface WaterTextures {
    depth: THREE.Texture;
    mask: THREE.Texture;
    sceneColor: THREE.Texture;
}
export interface WaterFragmentParams {
    uniforms: SurfaceUniforms;
    vertex: WaterVertexResult;
    oceanSim: IWaveSimulation;
    textures: WaterTextures;
    waterColor: WaterColor;
    fresnel: Fresnel;
    surfaceFoam: SurfaceFoam;
    waveFoam: WaveFoam;
    shorelineFoam: ShorelineFoam;
    sparkle: Sparkle;
    ssr: SSR;
    sss: SSS;
    sky: Sky | null;
    /** Whether Jacobian foam is enabled (capability flag, not a runtime toggle). */
    jacobianFoam: boolean;
    /** CascadeSampler instance for WebGPU path. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /**
     * Persistent foam accumulation system. When provided (WebGPU + quality
     * feature enabled), wave-crest foam uses its energy buffer for streaks
     * and decay tails. Null on WebGL or when disabled.
     */
    foamAccumulation: FoamAccumulation | null;
    gerstnerMaxWaves: number;
    /** Rain ripple simulation for normal blending. Null if not initialized. */
    rainRipples: RainRipples | null;
    /** Wake field sampler for wake normal blending. Null on WebGL or disabled. */
    wakeFieldSampler: IWakeFieldSampler | null;
    /** Whether running on WebGL backend (disables clip plane for split view). */
    isWebGL?: boolean;
}
/**
 * Builds the full fragment color shader graph for the water surface.
 * Returns a vec4 node (RGB color + alpha).
 */
export declare function buildWaterFragmentColor(params: WaterFragmentParams): Node;
//# sourceMappingURL=waterFragment.d.ts.map