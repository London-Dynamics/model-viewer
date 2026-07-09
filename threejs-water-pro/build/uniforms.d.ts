import * as THREE from "three/webgpu";
import type { TSLUniformNode } from "./types/tsl";
import type { WaveUniformParams, SunUniformParams } from "./types/params";
import type { OceanFloorOptions } from "./components/floor/types";
export declare class WaveUniforms {
    animationSpeed: number;
    amplitude: THREE.UniformNode<number>;
    windSpeed: THREE.UniformNode<number>;
    windDirection: THREE.UniformNode<number>;
    choppiness: THREE.UniformNode<number>;
    gravity: THREE.UniformNode<number>;
    jonswapGamma: THREE.UniformNode<number>;
    /**
     * Multiplier on the frequency-dependent directional spread exponent
     * s(ω/ωp) from Hasselmann 1980. `1.0` is physically calibrated; values
     * above 1 narrow waves toward the wind direction, below 1 broaden them.
     */
    spectralSharpness: THREE.UniformNode<number>;
    standingWaveRatio: THREE.UniformNode<number>;
    /** Set when any uniform changes. Consumers clear after reinit. */
    dirty: boolean;
    /**
     * Set when a parameter that affects the Phillips·JONSWAP 2D energy integrand
     * (`windSpeed`, `gravity`, `jonswapGamma`, `spectralSharpness`,
     * `standingWaveRatio`) changes. The cascade band assignment runs an init-time
     * numerical integral that depends on these — gating it on `bandDirty` instead
     * of `dirty` keeps slider drags on unrelated params (choppiness, direction,
     * amplitude) from paying the JS-side recompute cost.
     */
    bandDirty: boolean;
    update(params: WaveUniformParams): void;
}
export declare class SunUniforms {
    /**
     * Sun chromaticity, sourced from the preset's `sky.sun.diskColor`. CPU-only
     * (not a TSL uniform) — its sole consumer is the directional light that
     * lights the scene.
     */
    color: THREE.Color;
    direction: THREE.UniformNode<THREE.Vector3>;
    intensity: THREE.UniformNode<number>;
    update(params: SunUniformParams): void;
}
export declare class CascadeSimulationUniforms {
    resolution: THREE.UniformNode<number>;
    scale: THREE.UniformNode<number>;
    amplitudeScale: THREE.UniformNode<number>;
    /**
     * Lower edge of the wavenumber band this cascade owns (rad/m). Energy
     * below this is smoothly attenuated to zero so adjacent cascades partition
     * the spectrum without overlap. Tiny non-zero default keeps the shader's
     * `smoothstep(kLo, kLo·1.5, k)` well-defined before assignCascadeBands writes
     * a real value.
     */
    kBandLow: THREE.UniformNode<number>;
    /**
     * Upper edge of the wavenumber band this cascade owns (rad/m). The smooth
     * cutoff between `kBandHigh/1.5` and `kBandHigh` also serves as anti-alias
     * roll-off near the cascade's Nyquist limit. Large default acts as
     * "unbounded" until assignCascadeBands writes a real value.
     */
    kBandHigh: THREE.UniformNode<number>;
    /**
     * Init-time amplitude scaling that compensates for energy removed by the
     * k-band window, so each cascade's total displacement variance matches
     * the un-banded integral over its full [kFundamental, kNyquist] range.
     * Recomputed whenever scale/resolution/windSpeed/gravity change.
     */
    bandAmplitudeCompensation: THREE.UniformNode<number>;
    foamLeadingEdgeScale: THREE.UniformNode<number>;
    time: THREE.UniformNode<number>;
    deltaTime: THREE.UniformNode<number>;
    fftStage: THREE.UniformNode<number>;
    fftDirection: THREE.UniformNode<number>;
    fftComponent: THREE.UniformNode<number>;
    randomSeed: THREE.UniformNode<number>;
    init(resolution: number, scale: number, amplitudeScale: number): void;
    updateCascadeConfig(scale: number, amplitudeScale: number): void;
}
/**
 * Ocean floor displacement uniforms (FBM terrain variation)
 * Note: displacementScale uses inverted semantics - larger values = larger features
 */
export declare class FloorDisplacementUniforms {
    blendSoftness: THREE.UniformNode<number>;
    blendThreshold: THREE.UniformNode<number>;
    displacementScale: THREE.UniformNode<number>;
    displacementStrength: THREE.UniformNode<number>;
    lacunarity: THREE.UniformNode<number>;
    normalScale: THREE.UniformNode<number>;
    persistence: THREE.UniformNode<number>;
    textureDisplacementStrength: THREE.UniformNode<number>;
    textureScale: THREE.UniformNode<number>;
    update(options: OceanFloorOptions): void;
}
/**
 * Consolidated uniform object containing remaining surface shader uniform groups
 * that have not been converted to standalone shader classes.
 *
 * Shader classes (Fresnel, WaterColor, UnderwaterSurface,
 * SurfaceFoam, WaveFoam, ShorelineFoam, SSR, SSS, Sparkle, CascadeSampler) are
 * now owned directly by WaterSurfaceMaterial and passed individually to the
 * shader graph.
 */
export interface SurfaceUniforms {
    /** 1.0 when the camera is below the water surface, 0.0 above. */
    cameraSubmerged: TSLUniformNode;
    clipPlane: {
        cameraForward: TSLUniformNode;
        distance: TSLUniformNode;
        waterlineEnabled: TSLUniformNode;
        waterlineHighlightSharpness: TSLUniformNode;
        waterlineHighlightStrength: TSLUniformNode;
        waterlineNormalStrength: TSLUniformNode;
        waterlineSmoothness: TSLUniformNode;
        waterlineThickness: TSLUniformNode;
    };
    maskEnabled: TSLUniformNode;
    sun: {
        direction: TSLUniformNode;
        intensity: TSLUniformNode;
    };
    useDepthTexture: TSLUniformNode;
    useSceneColorTexture: TSLUniformNode;
    windDirection: TSLUniformNode;
}
//# sourceMappingURL=uniforms.d.ts.map