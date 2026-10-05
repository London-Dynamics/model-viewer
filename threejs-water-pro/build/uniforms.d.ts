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
    /**
     * Dominant wavelength in meters — the JONSWAP spectral peak (Hasselmann
     * et al. 1973). Sets wave size directly; `windSpeed` controls energy and
     * steepness at that size, independently.
     */
    peakWavelength: THREE.UniformNode<number>;
    gravity: THREE.UniformNode<number>;
    jonswapGamma: THREE.UniformNode<number>;
    /**
     * Multiplier on the frequency-dependent directional spread exponent
     * s(ω/ωp) from Hasselmann 1980. `1.0` is physically calibrated; values
     * above 1 narrow waves toward the wind direction, below 1 broaden them.
     */
    spectralSharpness: THREE.UniformNode<number>;
    /**
     * Blend between traveling waves (0) and standing waves (1). Wind
     * directional bias only applies to the traveling portion, so the spectrum
     * becomes more omnidirectional as this increases.
     */
    standingWaveRatio: THREE.UniformNode<number>;
    /** Set when any uniform changes. Consumers clear after reinit. */
    dirty: boolean;
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
    /**
     * Lower edge of this cascade's wavenumber band (rad/m). The spectrum shader
     * cross-fades spectral density over [kBandLow/1.5, kBandLow·1.5] with a
     * weight complementary to the previous cascade's high edge, so adjacent
     * cascades partition the spectrum without loss or double-counting. The
     * default is the "no low edge" sentinel used by the first cascade (see
     * cascadeBands.ts).
     */
    kBandLow: THREE.UniformNode<number>;
    /**
     * Upper edge of this cascade's wavenumber band (rad/m). For inner cascades
     * this is the seam shared with the next cascade's `kBandLow`; for the last
     * cascade, assignCascadeBands places it at kNyquist/1.5 so the cross-fade
     * reaches zero exactly at the Nyquist limit (anti-alias roll-off). Large
     * default acts as "unbounded" until assignCascadeBands writes a real value.
     */
    kBandHigh: THREE.UniformNode<number>;
    foamLeadingEdgeScale: THREE.UniformNode<number>;
    time: THREE.UniformNode<number>;
    deltaTime: THREE.UniformNode<number>;
    fftStage: THREE.UniformNode<number>;
    fftDirection: THREE.UniformNode<number>;
    fftComponent: THREE.UniformNode<number>;
    randomSeed: THREE.UniformNode<number>;
    init(resolution: number, scale: number): void;
    setScale(scale: number): void;
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