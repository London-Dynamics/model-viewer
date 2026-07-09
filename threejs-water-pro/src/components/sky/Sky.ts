import * as THREE from "three/webgpu";
import type {
  CubeTextureNode,
  TextureNode,
  UniformNode,
} from "three/webgpu";
import {
  vec3,
  vec4,
  Fn,
  If,
  normalize,
  texture,
  cubeTexture,
  pmremTexture,
  positionWorld,
  cameraPosition,
  uniform,
  equirectUV,
  clamp,
  saturate,
  dot,
  smoothstep,
  float,
} from "three/tsl";


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
export class Sky {
  private readonly _mesh: THREE.Mesh;
  private readonly _isCubemap: boolean;
  /**
   * The single source texture. The dome and fog sample it sharply via
   * {@link _equirectNode}/{@link _cubeNode}; the reflection sampler reads a
   * PMREM that {@link uploadSource} prefilters from it. {@link setTexture}
   * mutates it in place so all three stay one source of truth.
   */
  private readonly _source: THREE.Texture | THREE.CubeTexture;
  private readonly _equirectNode: TextureNode | null = null;
  private readonly _cubeNode: CubeTextureNode | null = null;
  private readonly _sunDirection: UniformNode<THREE.Vector3>;
  /**
   * Prefiltered reflection environment. {@link uploadSource} renders
   * {@link _source} into this PMREM, and the reflection sampler reads its
   * texture. Generating it explicitly — rather than letting `pmremTexture`
   * derive it lazily from the source — keeps the prefilter out of
   * `compileAsync`, where the source is not yet GPU-resident and the lazy
   * generation bakes (and caches) a black environment.
   */
  private _pmremGenerator: THREE.PMREMGenerator | null = null;
  private _pmrem: THREE.RenderTarget | null = null;

  public readonly brightnessUniform = uniform(1.0);
  public readonly reflectionBlurDistanceUniform = uniform(1500);
  public readonly reflectionDistanceBlurUniform = uniform(0.5);
  public readonly reflectionRoughnessUniform = uniform(0.02);
  public readonly sunEnabledUniform = uniform(0.0);
  public readonly sunRadiusUniform = uniform(0.005);
  public readonly sunColorUniform = uniform(new THREE.Color(0xfff8e0));
  public readonly sunEmissiveColorUniform = uniform(new THREE.Color(0xfff8e0));
  public readonly sunEmissiveIntensityUniform = uniform(5.0);

  constructor(params: SkyParams) {
    const hasEquirect = params.equirect !== undefined;
    const hasCube = params.cubeMap !== undefined;
    if (hasEquirect === hasCube) {
      throw new Error(
        "Sky: pass exactly one of `equirect` or `cubeMap` in SkyParams.",
      );
    }

    this._isCubemap = hasCube;
    this._source = hasCube ? params.cubeMap! : params.equirect!;
    if (hasCube) {
      this._cubeNode = cubeTexture(params.cubeMap!);
    } else {
      this._equirectNode = texture(params.equirect!);
    }

    this._sunDirection = params.sunDirection;
    this.brightnessUniform.value = params.brightness ?? 1.0;
    this.reflectionBlurDistanceUniform.value = params.reflectionBlurDistance ?? 1500;
    this.reflectionDistanceBlurUniform.value = params.reflectionDistanceBlur ?? 0.5;
    this.reflectionRoughnessUniform.value = params.reflectionRoughness ?? 0.02;

    const overlay = params.sunOverlay ?? {};
    this.sunEnabledUniform.value = overlay.enabled ? 1.0 : 0.0;
    this.sunRadiusUniform.value = overlay.radius ?? 0.005;
    if (overlay.color) this.sunColorUniform.value.set(overlay.color);
    if (overlay.emissiveColor)
      this.sunEmissiveColorUniform.value.set(overlay.emissiveColor);
    this.sunEmissiveIntensityUniform.value = overlay.emissiveIntensity ?? 5.0;

    const geometry = new THREE.SphereGeometry(2000, 32, 32);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });

    material.colorNode = this._buildDomeShader();

    this._mesh = new THREE.Mesh(geometry, material);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = -1000;
  }

  private _buildDomeShader() {
    return Fn(() => {
      const worldPos = positionWorld;
      const viewDir = normalize(worldPos.sub(cameraPosition));
      const sky = this._sampleSky(viewDir).toVar();
      const overlay = this._sampleSunOverlay(viewDir);
      return vec4(sky.add(overlay), 1.0);
    })();
  }

  /**
   * Sample the underlying sky texture in `dir` and apply brightness. Branches
   * once at construction on the input kind — equirect vs cubemap.
   */
  private _sampleSky(dir: ReturnType<typeof normalize>) {
    const sample = this._isCubemap
      ? this._cubeNode!.sample(dir)
      : this._equirectNode!.sample(equirectUV(dir));
    return vec3(sample.x, sample.y, sample.z).mul(this.brightnessUniform);
  }

  /**
   * Additive sun disk in view direction `dir`. Returns `(0,0,0)` when the
   * overlay is disabled — the smoothstep/dot work is gated by `If()` per the
   * project's TSL guidance.
   */
  private _sampleSunOverlay(dir: ReturnType<typeof normalize>) {
    const result = vec3(0, 0, 0).toVar();
    If(this.sunEnabledUniform.greaterThan(0.5), () => {
      const sunDir = normalize(vec3(this._sunDirection));
      // `1 - cosθ` increases with angle from the sun centre.
      const angleFromSun = float(1.0).sub(dot(dir, sunDir));
      const r2 = this.sunRadiusUniform.mul(this.sunRadiusUniform);
      const disk = float(1.0).sub(
        smoothstep(r2.mul(0.9), r2, angleFromSun),
      );
      const tint = vec3(this.sunColorUniform).add(
        vec3(this.sunEmissiveColorUniform).mul(this.sunEmissiveIntensityUniform),
      );
      result.assign(tint.mul(disk));
    });
    return result;
  }

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
  private _sampleReflection(dir: ReturnType<typeof normalize>) {
    const distanceToCamera = cameraPosition.sub(positionWorld).length();
    const distanceTerm = saturate(
      distanceToCamera.div(this.reflectionBlurDistanceUniform),
    ).mul(this.reflectionDistanceBlurUniform);
    const roughness = clamp(
      this.reflectionRoughnessUniform.add(distanceTerm),
      0.0,
      1.0,
    );
    const environment = this._pmrem !== null ? this._pmrem.texture : this._source;
    const sample = pmremTexture(environment, dir, roughness);
    return vec3(sample.x, sample.y, sample.z).mul(this.brightnessUniform);
  }

  /**
   * Sampler used by the water surface material for reflections off the sky.
   * Returns prefiltered linear HDR colour at `reflectDir` (no sun overlay —
   * the overlay is a dome-only visual; reflections see the underlying image
   * only).
   */
  public createReflectionSampler() {
    return Fn(([reflectDir]: [ReturnType<typeof vec3>]) => {
      return this._sampleReflection(normalize(reflectDir));
    });
  }

  /**
   * Sampler used by atmospheric fog to tint distant pixels by sky colour
   * along the view direction.
   */
  public createFogSampler() {
    return Fn(([sampleDir]: [ReturnType<typeof vec3>]) => {
      return this._sampleSky(normalize(sampleDir));
    });
  }

  public getMeshes(): THREE.Object3D[] {
    return [this._mesh];
  }

  public followCamera(camera: THREE.Camera): void {
    this._mesh.position.copy(camera.position);
  }

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
  public setTexture(
    tex: THREE.Texture | THREE.CubeTexture,
    renderer: THREE.WebGPURenderer,
  ): void {
    const incomingIsCube = (tex as THREE.CubeTexture).isCubeTexture === true;
    if (incomingIsCube !== this._isCubemap) {
      throw new Error(
        `Sky.setTexture: expected ${this._isCubemap ? "CubeTexture" : "equirect Texture"}, ` +
          "construct a new Sky to switch input kind.",
      );
    }
    const next = tex as THREE.Texture;
    const src = this._source as THREE.Texture;
    src.image = next.image;
    src.mapping = next.mapping;
    src.wrapS = next.wrapS;
    src.wrapT = next.wrapT;
    src.minFilter = next.minFilter;
    src.magFilter = next.magFilter;
    src.generateMipmaps = next.generateMipmaps;
    src.colorSpace = next.colorSpace;
    src.type = next.type;
    src.format = next.format;
    src.needsUpdate = true;
    this.uploadSource(renderer);
  }

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
  public uploadSource(renderer: THREE.WebGPURenderer): void {
    // Make the source GPU-resident so the prefilter below reads real pixels.
    renderer.initTexture(this._source);
    if (this._pmremGenerator === null) {
      this._pmremGenerator = new THREE.PMREMGenerator(renderer);
    }
    this._pmrem = this._isCubemap
      ? this._pmremGenerator.fromCubemap(
          this._source as THREE.CubeTexture,
          this._pmrem,
        )
      : this._pmremGenerator.fromEquirectangular(
          this._source as THREE.Texture,
          this._pmrem,
        );
  }

  public applySunOverlay(overlay: SkySunOverlayParams): void {
    if (overlay.enabled !== undefined) {
      this.sunEnabledUniform.value = overlay.enabled ? 1.0 : 0.0;
    }
    if (overlay.radius !== undefined) this.sunRadiusUniform.value = overlay.radius;
    if (overlay.color !== undefined) this.sunColorUniform.value.set(overlay.color);
    if (overlay.emissiveColor !== undefined)
      this.sunEmissiveColorUniform.value.set(overlay.emissiveColor);
    if (overlay.emissiveIntensity !== undefined)
      this.sunEmissiveIntensityUniform.value = overlay.emissiveIntensity;
  }

  public dispose(): void {
    this._mesh.geometry.dispose();
    (this._mesh.material as THREE.Material).dispose();
    this._pmrem?.dispose();
    this._pmremGenerator?.dispose();
  }
}
