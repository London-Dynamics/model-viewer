import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { IFoamFieldSampler } from "../simulation/foam";
import type { SkyProvider } from "../components/sky/SkyProvider";
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
import type { SceneDepthSampler } from "../rendering/passes/SceneDepthSampler";
import type { IWaterDepthPass } from "../rendering/passes/IWaterDepthPass";
export interface WaterTextures {
    /** Screen-space water mask. Omitted while masking is inactive. */
    mask?: THREE.Texture;
    sceneColor: THREE.Texture;
    /** Normalized-linear scene depth sampler from the scene capture pass. */
    sceneDepth: SceneDepthSampler;
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
    sky: SkyProvider | null;
    /** CascadeSampler instance for WebGPU path. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /**
     * Persistent foam-energy field sampler. When provided (on quality tiers with
     * wave foam enabled), wave-crest foam reads its energy for streaks and decay
     * tails. Null on tiers where wave foam is off.
     */
    foamFieldSampler: IFoamFieldSampler | null;
    /** Rain ripple simulation for normal blending. Null if not initialized. */
    rainRipples: RainRipples | null;
    /** Wake field sampler for wake normal blending. Null on WebGL or disabled. */
    wakeFieldSampler: IWakeFieldSampler | null;
    /**
     * Water-surface depth source for the refracted-column measurement. Null
     * until `RenderPassManager` binds it; the refraction path then falls back
     * to the fragment's own surface depth.
     */
    waterDepth: IWaterDepthPass | null;
    /** Whether running on WebGL backend (disables clip plane for split view). */
    isWebGL?: boolean;
}
/**
 * Builds the full fragment color shader graph for the water surface.
 * Returns a vec4 node (RGB color + alpha).
 */
export declare function buildWaterFragmentColor(params: WaterFragmentParams): Node;
//# sourceMappingURL=waterFragment.d.ts.map