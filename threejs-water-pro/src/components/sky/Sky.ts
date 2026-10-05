// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type {
  CubeTextureNode,
  Node,
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
  renderGroup,
  equirectUV,
  clamp,
  dot,
  smoothstep,
  float,
} from "three/tsl";
import type { SkyProvider } from "./SkyProvider";
import { RenderOrder } from "../../rendering/renderOrder";

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
   * disc. Defaults to `0.15`.
   */
  reflectionRoughness?: number;
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
export class Sky implements SkyProvider {
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
   *
   * A fresh target is allocated on every {@link uploadSource}, so the texture
   * reference changes with each swap. The `Environment` subsystem compares it
   * by reference each frame and, on a change, rebuilds `scene.environmentNode`
   * and rebinds the water material's reflection sampler; reusing one target
   * would leave both keyed to the previous bake.
   */
  private _pmremGenerator: THREE.PMREMGenerator | null = null;
  private _pmrem: THREE.RenderTarget | null = null;

  // Render group so the environment lighting node, which multiplies this in
  // for every lit mesh, updates from a shared buffer once per render rather
  // than per-object (an object-group uniform would reach only meshes that
  // happen to refresh that frame).
  public readonly brightnessUniform = uniform(1.0).setGroup(renderGroup);
  public readonly reflectionRoughnessUniform = uniform(0.15);
  public readonly sunEnabledUniform = uniform(0.0);
  public readonly sunRadiusUniform = uniform(0.005);
  public readonly sunColorUniform = uniform(new THREE.Color(0xfff8e0));
  public readonly sunEmissiveColorUniform = uniform(new THREE.Color(0xfff8e0));
  public readonly sunEmissiveIntensityUniform = uniform(5.0);

  constructor(renderer: THREE.WebGPURenderer, params: SkyParams) {
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
    this.reflectionRoughnessUniform.value = params.reflectionRoughness ?? 0.15;

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
    this._mesh.renderOrder = RenderOrder.opaque.skyDome;

    this.uploadSource(renderer);
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
  private _sampleReflection(
    dir: ReturnType<typeof normalize>,
    extraRoughness: Node,
  ) {
    // Base micro-roughness plus the wave slope variance the pixel footprint
    // folds away (from the surface material). This replaces the former
    // hand-tuned distance blur: reading a rougher prefiltered mip where the
    // waves are unresolved is what breaks up the distant sky mirror, and it
    // tracks wind and viewing angle automatically.
    const roughness = clamp(
      this.reflectionRoughnessUniform.add(extraRoughness),
      0.0,
      1.0,
    );
    const environment = this._pmrem !== null ? this._pmrem.texture : this._source;
    const sample = pmremTexture(environment, dir, roughness);
    return vec3(sample.x, sample.y, sample.z).mul(this.brightnessUniform);
  }

  /**
   * Sampler used by the water surface material for reflections off the sky.
   * Returns prefiltered linear HDR colour at `reflectDir`, blurred by
   * `extraRoughness` (the surface's sub-footprint slope variance). No sun
   * overlay — that is a dome-only visual; reflections see the underlying
   * image only.
   */
  public createReflectionSampler() {
    return Fn(
      ([reflectDir, extraRoughness]: [ReturnType<typeof vec3>, Node]) => {
        return this._sampleReflection(normalize(reflectDir), extraRoughness);
      },
    );
  }

  /**
   * The prefiltered reflection environment ({@link _pmrem}) — the
   * `SkyProvider` accessor other water-pro consumers (scene.environment,
   * rough reflections) read as their single source. Falls back to the raw
   * source before the first {@link uploadSource}, matching
   * {@link _sampleReflection}.
   */
  public getEnvironmentTexture(): THREE.Texture {
    return this._pmrem !== null
      ? this._pmrem.texture
      : (this._source as THREE.Texture);
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

  /**
   * Brightness multiplier on the sampled sky radiance. Backs
   * {@link brightnessUniform}, which the dome, fog, reflections, and scene
   * environment lighting all track live, so a change reaches every surface the
   * same frame.
   */
  get brightness(): number {
    return this.brightnessUniform.value;
  }

  set brightness(value: number) {
    this.brightnessUniform.value = value;
  }

  public getBrightnessNode(): Node {
    return this.brightnessUniform;
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
   * it, so the shaders that sample the source directly (the dome colour node
   * and the fog sampler) see the new image without recompilation. The source
   * is then re-uploaded and the reflection PMREM re-prefiltered into a fresh
   * target via {@link uploadSource}, whose changed reference drives the
   * reflection and scene-environment rebind.
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
   * The constructor and {@link setTexture} call this for you; you only need
   * it directly if you mutate the source texture by some other route. A fresh
   * target is allocated each call and the previous one disposed, so the
   * texture reference changes. The `Environment` subsystem detects that change
   * and reruns the `setSky` rebind, which rebuilds `scene.environmentNode` off
   * the new bake and rebinds the water material's reflection sampler.
   */
  public uploadSource(renderer: THREE.WebGPURenderer): void {
    // Make the source GPU-resident so the prefilter below reads real pixels.
    renderer.initTexture(this._source);
    if (this._pmremGenerator === null) {
      this._pmremGenerator = new THREE.PMREMGenerator(renderer);
    }
    const previous = this._pmrem;
    this._pmrem = this._isCubemap
      ? this._pmremGenerator.fromCubemap(this._source as THREE.CubeTexture)
      : this._pmremGenerator.fromEquirectangular(this._source as THREE.Texture);
    previous?.dispose();
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
