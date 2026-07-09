import * as THREE from "three/webgpu";
import type { UniformNode } from "three/webgpu";
export interface SkySunOverlayParams {
    /** Whether the disk renders. Default `false`. */
    enabled?: boolean;
    /** Angular half-radius in `1 - cosθ` units. Default `0.005`. */
    radius?: number;
    /** Base disk colour. Default `#fff8e0`. */
    color?: string;
    /** Additive emissive tint. Default `#fff8e0`. */
    emissiveColor?: string;
    /** Additive emissive multiplier. Default `5`. */
    emissiveIntensity?: number;
}
/**
 * Construction params for {@link Sky}. Exactly one of `equirect` or `cubeMap`
 * must be provided; the dome shader and reflection / fog samplers branch on
 * that choice at construction time.
 */
export interface SkyParams {
    /** Equirectangular sky texture (e.g. a Polyhaven HDRI). */
    equirect?: THREE.Texture;
    /** Six-face cube map. */
    cubeMap?: THREE.CubeTexture;
    /** Brightness multiplier on the sampled colour. Defaults to `1.0`. */
    brightness?: number;
    /**
     * Base microfacet roughness used when sampling the prefiltered environment
     * for reflections, in `[0, 1]`. `0` is a sharp mirror; small values pull
     * the reflection to a slightly lower mip, taming a razor-sharp baked sun
     * disc. Defaults to `0.02`.
     */
    reflectionRoughness?: number;
    /**
     * How much the reflection roughness widens with distance from the camera,
     * in `[0, 1]`. Distant water covers many wavelets per pixel, so a mirror
     * sample there aliases bright sky features into a firefly field; this
     * ramps toward a blurrier mip with distance to integrate that energy.
     * `0` disables distance widening. Defaults to `0.5`.
     */
    reflectionDistanceBlur?: number;
    /**
     * World-space distance at which the distance-driven blur reaches its
     * configured maximum (`reflectionDistanceBlur`). Scale this to match your
     * scene — a scene spanning 50 units needs a much smaller value than one
     * spanning 50 000. Defaults to `1500`.
     */
    reflectionBlurDistance?: number;
    /**
     * Sun-direction uniform owned by `Lighting` — used by the optional sun
     * disk overlay. Required regardless of whether the disk is enabled so the
     * overlay can be toggled at runtime without rebuilding the shader.
     */
    sunDirection: UniformNode<THREE.Vector3>;
    /** Optional sun disk overlay configuration. Disk is off by default. */
    sunOverlay?: SkySunOverlayParams;
}
/**
 * Image-based sky with an optional additive sun disk overlay.
 *
 * Accepts either an **equirectangular** image (`.hdr`, `.exr`, Adobe UltraHDR
 * JPG, or plain LDR JPG with `colorSpace = SRGBColorSpace`) or a **cube map**.
 * The sampler branches on the input at construction time; mixing the two
 * within a single instance is not supported — pass exactly one in `SkyParams`,
 * and {@link setTexture} accepts the same kind for in-place swaps.
 *
 * Equirect textures must have `mapping = EquirectangularReflectionMapping`.
 * For HDR sources no colour-space tagging is needed; for LDR JPGs tag
 * `colorSpace = SRGBColorSpace` so Three.js linearises on sample.
 */
export declare class Sky {
    private readonly _mesh;
    private readonly _isCubemap;
    /**
     * The single source texture. The dome and fog sample it sharply via
     * {@link _equirectNode}/{@link _cubeNode}; the reflection sampler reads a
     * PMREM that {@link uploadSource} prefilters from it. {@link setTexture}
     * mutates it in place so all three stay one source of truth.
     */
    private readonly _source;
    private readonly _equirectNode;
    private readonly _cubeNode;
    private readonly _sunDirection;
    /**
     * Prefiltered reflection environment. {@link uploadSource} renders
     * {@link _source} into this PMREM, and the reflection sampler reads its
     * texture. Generating it explicitly — rather than letting `pmremTexture`
     * derive it lazily from the source — keeps the prefilter out of
     * `compileAsync`, where the source is not yet GPU-resident and the lazy
     * generation bakes (and caches) a black environment.
     */
    private _pmremGenerator;
    private _pmrem;
    readonly brightnessUniform: THREE.UniformNode<number>;
    readonly reflectionBlurDistanceUniform: THREE.UniformNode<number>;
    readonly reflectionDistanceBlurUniform: THREE.UniformNode<number>;
    readonly reflectionRoughnessUniform: THREE.UniformNode<number>;
    readonly sunEnabledUniform: THREE.UniformNode<number>;
    readonly sunRadiusUniform: THREE.UniformNode<number>;
    readonly sunColorUniform: THREE.UniformNode<THREE.Color>;
    readonly sunEmissiveColorUniform: THREE.UniformNode<THREE.Color>;
    readonly sunEmissiveIntensityUniform: THREE.UniformNode<number>;
    constructor(params: SkyParams);
    private _buildDomeShader;
    /**
     * Sample the underlying sky texture in `dir` and apply brightness. Branches
     * once at construction on the input kind — equirect vs cubemap.
     */
    private _sampleSky;
    /**
     * Additive sun disk in view direction `dir`. Returns `(0,0,0)` when the
     * overlay is disabled — the smoothstep/dot work is gated by `If()` per the
     * project's TSL guidance.
     */
    private _sampleSunOverlay;
    /**
     * Sample the prefiltered environment for reflections. Unlike the sharp
     * dome/fog sample, this reads a roughness-selected mip of the Sky-owned
     * PMREM ({@link uploadSource}): a sharp mirror sample re-images the sky's
     * brightest texel (a baked sun/moon disc carries HDR values far above 1) on
     * every wavelet, which aliases into a firefly field and blows out under
     * bloom. Reading a prefiltered mip integrates that energy over the BRDF
     * lobe, bounding the peak. The effective roughness ramps from a base value
     * with distance, because distant water packs many wavelets under one pixel.
     * Brightness matches the dome and fog samples. The PMREM uses a cubeUV
     * layout, so the reflection has no `atan2` seam.
     *
     * Reads {@link _pmrem} once it exists; before the first {@link uploadSource}
     * it falls back to a lazy PMREM of the source so the graph still builds.
     */
    private _sampleReflection;
    /**
     * Sampler used by the water surface material for reflections off the sky.
     * Returns prefiltered linear HDR colour at `reflectDir` (no sun overlay —
     * the overlay is a dome-only visual; reflections see the underlying image
     * only).
     */
    createReflectionSampler(): THREE.TSL.ShaderNodeFn<[number | THREE.Node]>;
    /**
     * Sampler used by atmospheric fog to tint distant pixels by sky colour
     * along the view direction.
     */
    createFogSampler(): THREE.TSL.ShaderNodeFn<[number | THREE.Node]>;
    getMeshes(): THREE.Object3D[];
    followCamera(camera: THREE.Camera): void;
    /**
     * Swap the underlying sky texture in place and refresh the reflection
     * environment — one call covers the dome, fog, and reflections. The new
     * texture must match the kind this `Sky` was constructed with (equirect vs
     * cubemap); to switch kinds, construct a new `Sky`. The image and sampler
     * settings are copied onto the existing source object rather than swapping
     * it, so every downstream shader that captured it (the dome colour node and
     * the water material's reflection / fog samplers) sees the new texture
     * without recompilation. The source is then re-uploaded and the reflection
     * PMREM re-prefiltered via {@link uploadSource}.
     */
    setTexture(tex: THREE.Texture | THREE.CubeTexture, renderer: THREE.WebGPURenderer): void;
    /**
     * Prefilter the source into the Sky-owned reflection environment ({@link
     * _pmrem}). The reflection sampler reads a roughness-selected mip of this
     * PMREM rather than deriving one lazily from the source inside the shader
     * graph — the lazy path generates during `renderer.compileAsync`, when the
     * freshly-loaded source is still CPU-only, and bakes a black environment
     * that is then cached. Running the prefilter here, in normal app context
     * after an explicit GPU upload, guarantees it reads real pixels.
     *
     * `WaterSystem.setSky` and {@link setTexture} call this for you; you only
     * need it directly if you mutate the source texture by some other route. The
     * target is reused across calls so the reflection sampler that captured its
     * texture picks up a swap without a shader rebuild.
     */
    uploadSource(renderer: THREE.WebGPURenderer): void;
    applySunOverlay(overlay: SkySunOverlayParams): void;
    dispose(): void;
}
//# sourceMappingURL=Sky.d.ts.map