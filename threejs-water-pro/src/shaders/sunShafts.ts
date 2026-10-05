// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Underwater sun shafts (god rays) effect.
 *
 * Uses screen-space radial pattern with depth-aware occlusion.
 * Objects between the camera and sun cast soft shadows into the shafts.
 *
 * The intensity computation runs at reduced resolution via SunShaftPass.
 * The composite step samples the reduced-resolution texture and adds it
 * to the scene color at full resolution.
 *
 * Surface transmission is modulated by sampling the cascade-0 normal
 * texture (exposed by both backends — WebGPU writes a StorageTexture
 * RGBA16F storage texture; WebGL writes a render target).
 */
import {
  dot,
  float,
  fract,
  Fn,
  If,
  int,
  length,
  Loop,
  max,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  textureLevel,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import type { Node } from "./types";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { IWaterDepthPass } from "../rendering/passes/IWaterDepthPass";
import type { SceneDepthSampler } from "../rendering/passes/SceneDepthSampler";
import type { WaterSubsystem } from "../systems/types";
import type { IWaveSimulation } from "../simulation/waves";
import type { Lighting } from "../systems/Lighting";
import type { Fresnel } from "./fresnel";
import type { UnderwaterStateController } from "../systems/UnderwaterStateController";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
import { SunShaftPass } from "../rendering/passes/SunShaftPass";

/** Preset-facing parameters for sun shafts. */
export interface SunShaftsParams {
  /** Whether sun shafts are active. */
  enabled: boolean;
  /** Master brightness (0–1). */
  intensity: number;
}

/** Options for {@link SunShafts.setWaveTexture}. */
export interface SunShaftsWaveTextureOptions {
  /** Normal texture from wave simulation (WebGL render target). */
  normalTexture: THREE.Texture;
  /** World-space scale of the cascade. */
  scale: number;
}

/**
 * Underwater sun shafts using screen-space radial projection.
 *
 * Creates volumetric-looking light shafts by projecting a radial
 * pattern from the sun's screen position, modulated by depth.
 *
 * The shader is split into two stages:
 * - {@link buildIntensityNode} computes scalar intensity at reduced resolution
 * - {@link buildComposite} reconstructs shaft color and adds it to scene color
 */
export class SunShafts implements WaterSubsystem {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _intensity = uniform(0.2);

  private _falloff = uniform(1.5);
  private _fadeIn = uniform(0.25);
  private _softness = uniform(0.75);

  // Sun screen position (updated each frame from JS)
  private _sunScreenX = uniform(0.5);
  private _sunScreenY = uniform(0.5);
  private _sunVisible = uniform(1.0);

  // Camera world position (for mapping screen angle to surface sample point)
  private _cameraWorldX = uniform(0.0);
  private _cameraWorldZ = uniform(0.0);

  // Scene-depth sampler — owned by the capture pass; target rebuilds and
  // camera changes propagate through its internal nodes.
  private _sceneDepth: SceneDepthSampler | null = null;
  // Depth-sample source — owned by `RenderPassManager`. Sample builders
  // route through `IWaterDepthPass.sampleX(uv)` so the backend split
  // (WebGPU single-pass MIN vs. WebGL three-pass) is hidden here.
  private _waterDepthPass: IWaterDepthPass | null = null;

  // Output texture node (sun shaft intensity rendered at reduced resolution)
  private _outputTextureNode: TextureNode;

  // Wave normal sampling
  private _waveScale = uniform(100.0);
  private _hasNormalSampler = uniform(0.0);
  private _normalTexture: TextureNode;

  /** Reused workspace vector for the per-frame screen-position projection. */
  private _sunViewPos = new THREE.Vector3();

  // Runtime refs — wired by `attachRuntimeRefs` after the rest of the
  // water system is constructed. `renderPass` self-gates if any are null,
  // so the constructor can run before they are available.
  private _camera: THREE.PerspectiveCamera | null = null;
  private _lighting: Lighting | null = null;
  private _fresnel: Fresnel | null = null;
  private _underwaterController: UnderwaterStateController | null = null;

  // Owned render-pass machinery. `attachPass` constructs both fields.
  private _pass: SunShaftPass | null = null;

  constructor() {
    const createPlaceholder = () => {
      const data = new Float32Array([1, 0, 0, 1]);
      const tex = new THREE.DataTexture(
        data,
        1,
        1,
        THREE.RGBAFormat,
        THREE.FloatType,
      );
      tex.needsUpdate = true;
      return tex;
    };

    this._outputTextureNode = texture(createPlaceholder());
    this._normalTexture = texture(createPlaceholder());
  }

  // ============= Public Getters/Setters =============

  /** Whether sun shafts are active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Distance from sun center where rays start appearing (0–1). */
  get fadeIn(): number {
    return this._fadeIn.value;
  }

  set fadeIn(value: number) {
    this._fadeIn.value = value;
  }

  /** Radial falloff distance from sun center (0.5–3). */
  get falloff(): number {
    return this._falloff.value;
  }

  set falloff(value: number) {
    this._falloff.value = value;
  }

  /** Master brightness (0–1). */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  /** Width of the intensity fade region (0–1). Higher = softer rays. */
  get softness(): number {
    return this._softness.value;
  }

  set softness(value: number) {
    this._softness.value = value;
  }

  // ============= Texture Setters =============

  /**
   * Re-bind scene depth and wire the water depth source. Called once at
   * construction and again on every resize / quality switch — the scene
   * depth target identity changes across both. The `IWaterDepthPass`
   * reference itself survives quality changes; only its internal
   * texture targets get reallocated, and the TSL nodes returned by the
   * sample builders track those swaps automatically.
   */
  bindDepthTextures(rp: RenderPassManager): void {
    this._sceneDepth = rp.sceneDepth;
    this._waterDepthPass = rp.waterDepth;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: SunShaftsParams): void {
    this.enabled = params.enabled;
    this.intensity = params.intensity;
  }

  /**
   * Wire the runtime refs SunShafts needs to project the sun into
   * screen space each frame. Called once during `WaterSystem.create`
   * after `UnderwaterStateController` exists; not needed for the
   * sub-classes invoked during shader compilation.
   */
  attachRuntimeRefs(refs: {
    camera: THREE.PerspectiveCamera;
    lighting: Lighting;
    fresnel: Fresnel;
    underwaterController: UnderwaterStateController;
  }): void {
    this._camera = refs.camera;
    this._lighting = refs.lighting;
    this._fresnel = refs.fresnel;
    this._underwaterController = refs.underwaterController;
  }

  /** Replace the camera (called from `WaterSystem.set camera`). */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this._camera = camera;
  }

  /**
   * Build the reduced-resolution intensity pass and bind its output
   * texture for the composite step. Idempotent; calling again recreates
   * the underlying render target with the new size / resolution scale.
   *
   * @param width - Drawing-buffer width in pixels.
   * @param height - Drawing-buffer height in pixels.
   * @param resolutionScale - Pass resolution scale from the quality config.
   */
  attachPass(width: number, height: number, resolutionScale: number): void {
    if (!this._lighting) {
      throw new Error(
        "SunShafts.attachPass requires runtime refs — call attachRuntimeRefs first.",
      );
    }
    this._pass?.dispose();
    const pass = new SunShaftPass(width, height, resolutionScale);
    pass.build(this.buildIntensityNode(this._lighting.sun.direction));
    this._outputTextureNode.value = pass.getTexture();
    this._pass = pass;
  }

  /** Resize the intensity pass to match the new drawing-buffer size. */
  resize(width: number, height: number): void {
    if (!this._pass) return;
    this._outputTextureNode.value = this._pass.setSize(width, height);
  }

  /**
   * Apply a quality-level switch. Updates the resolution scale on the
   * intensity pass, rebinds the output texture, and rebuilds the pass
   * material (the wave-data nodes the intensity shader binds to are
   * re-created on every cascade rebuild).
   */
  onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void {
    if (!this._pass || !this._lighting) return;
    this._outputTextureNode.value = this._pass.setResolutionScale(
      config.sunShaftResolutionScale,
    );
    this._pass.build(this.buildIntensityNode(this._lighting.sun.direction));
  }

  /**
   * Once-per-displayed-frame render. Self-gates on `enabled` and on the
   * underwater controller's `underwaterEnabled` (sun shafts are an
   * underwater-only effect). Projection runs once at render time, not
   * once per simulation substep — multiple substeps in a frame still
   * produce one consistent shaft direction.
   */
  renderPass(renderer: THREE.WebGPURenderer): void {
    if (!this._pass) return;
    if (!this.enabled) return;
    if (!this._underwaterController?.underwaterEnabled) return;
    if (!this._camera || !this._lighting || !this._fresnel) return;

    this._updateScreenPosition(
      this._camera,
      this._lighting.sun.direction.value,
      this._fresnel.iorRatio,
    );
    this._pass.render(renderer);
  }

  dispose(): void {
    this._pass?.dispose();
    this._pass = null;
  }

  /**
   * Project the sun into screen space and refresh the uniforms the
   * radial shaft shader consumes. Invoked from {@link renderPass} once
   * per displayed frame while underwater rendering is active.
   *
   * The shafts are an underwater-only effect — they only render when
   * the per-pixel detection inside the intensity shader flags a pixel
   * as underwater, and `renderPass` already gates the entire pass on
   * `underwaterController.underwaterEnabled`. The sun is therefore
   * always being viewed through the refracting water surface, so the
   * apparent direction is Snell-compressed toward vertical
   * (`sin θ_apparent = sin θ_true / n_water`). When the sun is behind
   * the camera the visible flag drops to zero and the shafts vanish.
   */
  private _updateScreenPosition(
    camera: THREE.PerspectiveCamera,
    sunDirection: THREE.Vector3,
    iorRatio: number,
  ): void {
    const v = this._sunViewPos;

    // Snell's window: the apparent direction is compressed toward
    // vertical. Compute apparent (x, z), recover y on the unit
    // hemisphere; the result still points upward through the surface.
    const apparentX = sunDirection.x / iorRatio;
    const apparentZ = sunDirection.z / iorRatio;
    const apparentY = Math.sqrt(
      Math.max(0, 1 - apparentX * apparentX - apparentZ * apparentZ),
    );
    v.set(apparentX, apparentY, apparentZ);

    // World → view: rotation only, no translation (it's a direction).
    v.transformDirection(camera.matrixWorldInverse);

    // In view space, the camera looks down −Z. Sun is in front iff z < 0.
    const viewZ = v.z;
    const sunInFront = viewZ < 0;

    if (!sunInFront) {
      this._sunScreenX.value = 0.5;
      this._sunScreenY.value = 0.5;
      this._sunVisible.value = 0.0;
      return;
    }

    // Perspective divide → NDC. Focal-length factors come from the
    // projection matrix: proj[0] for X, proj[5] for Y.
    const proj = camera.projectionMatrix.elements;
    const invZ = 1.0 / -viewZ;
    const ndcX = v.x * invZ * proj[0];
    const ndcY = v.y * invZ * proj[5];

    // NDC (−1..1) → UV (0..1); flip Y to match texture convention.
    this._sunScreenX.value = ndcX * 0.5 + 0.5;
    this._sunScreenY.value = 1.0 - (ndcY * 0.5 + 0.5);
    this._sunVisible.value = 1.0;

    // Camera world position drives the surface-normal sampling that
    // modulates per-ray transmission. Only X / Z matter (the water
    // plane is horizontal).
    this._cameraWorldX.value = camera.position.x;
    this._cameraWorldZ.value = camera.position.z;
  }

  /**
   * Set wave texture reference for surface transmission. Must be called
   * before {@link attachPass} for wave-based transmission to take
   * effect; the cascade-changed event in `OceanFloor` /
   * `WaterSystem._fireCascadeChanged` calls this whenever the cascade-0
   * normal texture is rebuilt.
   */
  setWaveTexture(options: SunShaftsWaveTextureOptions): void {
    this._waveScale.value = options.scale;
    this._normalTexture = texture(options.normalTexture);
    this._hasNormalSampler.value = 1.0;
  }

  /**
   * Rebind to the wave simulation. Reads cascade-0's normal texture and
   * scale — the inputs the surface-transmission shader consumes. Called
   * whenever cascade configuration changes or the wave sim is recreated.
   */
  onCascadeChanged(sim: IWaveSimulation): void {
    const scale = sim.getScale(0);
    const normalTexture = sim.getNormalTexture(0);

    if (normalTexture) {
      this.setWaveTexture({ normalTexture, scale });
    } else {
      this._waveScale.value = scale;
    }
  }

  /**
   * Builds the sun shaft intensity node for rendering at reduced resolution.
   *
   * Returns a vec4 where R is the scalar shaft intensity.
   * When disabled, outputs vec4(0, 0, 0, 1). Called from {@link attachPass}
   * and {@link onQualityChanged} when the underlying wave data changes.
   *
   * @param sunDir - Sun direction node (normalized, pointing toward sun).
   */
  private buildIntensityNode(sunDir: Node): Node {
    const sceneDepth = this._sceneDepth;
    if (!sceneDepth) {
      throw new Error(
        "SunShafts.buildIntensityNode: bindDepthTextures() must be called before building the node graph.",
      );
    }
    return Fn(() => {
      const shaftIntensityOutput = float(0.0).toVar("shaftIntensityOutput");

      If(this._enabled.greaterThan(0.5), () => {
        const uv = screenUV;

        // No per-pixel underwater gate here. This pass renders at reduced
        // resolution, so gating per texel would punch holes at knife-edge fog
        // pixels that bilinear upsampling then smears into the surrounding
        // shaft glow (the dark speckles). Instead the intensity is a smooth
        // glow and the FULL-RESOLUTION composite (`buildComposite`) is the sole
        // underwater confinement — it gates the add by `clippedAny < clippedFront`,
        // the same rule as the fog and the despeckle.

        // Sun screen position (from uniform, updated each frame in JS)
        const sunX = this._sunScreenX;
        const sunY = this._sunScreenY;
        const sunUV = vec2(sunX, sunY);

        // Vector from current pixel to sun position
        const toSunX = sunX.sub(uv.x);
        const toSunY = sunY.sub(uv.y);
        const toSun2D = vec2(toSunX, toSunY);
        const distToSun = length(toSun2D);

        // Direction from pixel to sun (used for surface transmission sampling)
        const toSunDir = toSun2D.div(distToSun.max(0.0001));

        // Radial falloff from sun position (shafts are brighter near sun)
        const normalizedDist = distToSun.div(this._falloff).clamp(0.0, 1.0);
        const radialFalloff = float(1.0).sub(normalizedDist);

        // Sun elevation factor (stronger when sun is higher)
        const sunFade = sunDir.y.clamp(0.0, 1.0).pow(0.3);

        // ========================================
        // OCCLUSION: Radial blur sampling with dithering
        // ========================================
        // Sample scene depth along ray from pixel toward sun.
        // Accumulate occlusion where geometry blocks the light path.
        // Per-pixel dither offset converts banding to imperceptible noise.
        const occlusionAccum = float(0.0).toVar("occlusionAccum");
        const numSamples = float(16.0);
        const occlusionLength = float(0.5);
        const occlusionSoftness = float(0.1);

        // Interleaved gradient noise for dithering (breaks up banding)
        const pixelCoord = uv.mul(screenSize);
        const dither = fract(
          float(52.9829189).mul(
            fract(
              pixelCoord.x.mul(0.06711056).add(pixelCoord.y.mul(0.00583715)),
            ),
          ),
        );

        // Depth threshold: far depth values (sky/water volume) = non-occluder
        const farThreshold = float(0.95);

        const sampleIndex = float(0.0).toVar("sampleIndex");
        Loop(int(16), () => {
          // Interpolate from pixel UV toward sun UV, with dither offset
          const t = sampleIndex
            .add(dither)
            .div(numSamples)
            .mul(occlusionLength);
          const sampleUV = mix(uv, sunUV, t);

          // Sample scene depth at this point
          const sampleDepth = sceneDepth.sample(sampleUV);

          // Far depth = 1 (no occlusion), geometry = 0 (occluded)
          // smoothstep creates soft edges at geometry boundaries
          const sampleOcclusion = smoothstep(
            farThreshold.sub(occlusionSoftness),
            farThreshold,
            sampleDepth,
          );

          occlusionAccum.addAssign(sampleOcclusion);
          sampleIndex.addAssign(1.0);
        });

        // Average the samples to get final occlusion factor (0 = fully occluded, 1 = no occlusion)
        const finalOcclusion = occlusionAccum.div(numSamples);

        // ========================================
        // STARBURST FADE: Fade rays near sun center
        // ========================================
        // Prevents starburst from extending into above-water regions.
        // Rays fade out as they approach the sun center (where they would
        // cross the waterline into air). User-controllable via fadeIn.
        const starburstFade = smoothstep(float(0.0), this._fadeIn, distToSun);

        // ========================================
        // SURFACE TRANSMISSION: Fresnel at ray entry point
        // ========================================
        // Each ray enters the water at a point on the surface. The surface normal
        // at that point determines how much light transmits vs reflects (Fresnel).
        // Rays at grazing angles to tilted wave faces are attenuated.
        const surfaceTransmission = this.buildSurfaceTransmission(
          toSunDir,
          sunDir,
        );

        // Only the sun-above-horizon gate here; the underwater confinement is
        // done at full resolution in the composite (see note above).
        const sunAboveHorizon = sunDir.y.greaterThan(0.05);
        const shouldProcessFloat = sunAboveHorizon.select(
          float(1.0),
          float(0.0),
        );

        // Compute final shaft intensity
        const shaftIntensityRaw = surfaceTransmission
          .mul(radialFalloff)
          .mul(sunFade)
          .mul(this._sunVisible)
          .mul(this._intensity)
          .mul(finalOcclusion)
          .mul(starburstFade);

        // Apply soft fade to low-intensity values
        const shaftIntensity = smoothstep(
          float(0.0),
          this._softness,
          shaftIntensityRaw,
        );

        shaftIntensityOutput.assign(shaftIntensity.mul(shouldProcessFloat));
      });

      return vec4(shaftIntensityOutput, 0.0, 0.0, 1.0);
    })();
  }

  /**
   * Builds the underwater gate (1 = underwater, 0 = above water) that confines
   * the shaft composite. Same per-pixel rule as the Underwater post-pass:
   * `clippedAny < clippedFront` (closest behind-clip water fragment is a back
   * face). When no depth pass is wired, returns 1.0 (ungated).
   *
   * Built here, separate from {@link buildComposite}, because `buildComposite`
   * is compiled to AssemblyScript by the WASM shader engine, which can't follow
   * the `IWaterDepthPass` sample methods (they read a GPU-only render target).
   * The gate is computed on the GPU side (in the post-process pipeline, which
   * is not AS-compiled) and passed into `buildComposite` as a plain float node.
   */
  buildUnderwaterGate(): Node {
    const wdp = this._waterDepthPass;
    if (!wdp) {
      return float(1.0);
    }
    return wdp
      .sampleClippedAnyDepth(screenUV)
      .lessThan(wdp.sampleClippedFrontDepth(screenUV))
      .select(float(1.0), float(0.0));
  }

  /**
   * Builds the composite node that samples the reduced-resolution sun shaft
   * texture and adds it to the scene color, scaled by the underwater `gate`.
   *
   * The shaft texture is rendered at reduced resolution; scaling by the gate
   * (see {@link buildUnderwaterGate}) confines it to the underwater region so
   * bilinear upsampling can't bleed shaft brightening across the waterline.
   *
   * @param inputColor - Scene color after underwater effects.
   * @param gate - Underwater gate in [0, 1] from {@link buildUnderwaterGate}.
   */
  buildComposite(inputColor: Node, gate: Node): Node {
    return Fn(() => {
      const color = vec4(inputColor).toVar("sunShaftsComposite");

      If(this._enabled.greaterThan(0.5), () => {
        const shaftIntensity = this._outputTextureNode.sample(screenUV).r;
        const shaftColor = vec3(1.0, 0.95, 0.85).mul(shaftIntensity);
        color.assign(vec4(color.xyz.add(shaftColor.mul(gate)), color.w));
      });

      return color;
    })();
  }

  // ============= Private Helpers =============

  /**
   * Builds the surface transmission factor based on Fresnel at the ray entry point.
   * When no normal sampler is configured, returns 1.0 (full transmission).
   *
   * @param toSunDir - Normalized 2D direction from pixel to sun in screen space.
   * @param sunDir - Sun direction (normalized, pointing toward sun).
   */
  private buildSurfaceTransmission(toSunDir: Node, sunDir: Node): Node {
    const transmission = float(1.0).toVar();

    If(this._hasNormalSampler.greaterThan(0.5), () => {
      // Map the ray's direction to a world-space offset for normal sampling
      const sampleRadius = this._waveScale.mul(0.3);
      const offsetX = toSunDir.x.mul(sampleRadius);
      const offsetZ = toSunDir.y.mul(sampleRadius);

      // Sample position = camera position + angular offset
      const sampleX = this._cameraWorldX.add(offsetX);
      const sampleZ = this._cameraWorldZ.add(offsetZ);

      const normalSample = this.sampleNormal(sampleX, sampleZ);

      // Normals are stored in [0,1] range, convert to [-1,1]
      const rawNormal = normalSample.xyz.mul(2.0).sub(1.0);
      const normalLen = length(rawNormal);
      const surfaceNormal = normalLen
        .greaterThan(0.001)
        .select(rawNormal.div(normalLen), vec3(0.0, 1.0, 0.0));

      // NdotL = 1 when normal aligns with light → full transmission
      // NdotL = 0 when perpendicular → reduced transmission
      const NdotL = max(dot(surfaceNormal, sunDir), float(0.0));
      transmission.assign(float(0.3).add(NdotL.mul(0.7)));
    });

    return transmission;
  }

  /**
   * Samples the wave normal at a world position.
   * Uses buffer path (WebGPU) or texture path (WebGL) based on data source.
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   */
  private sampleNormal(worldX: Node, worldZ: Node): Node {
    // The cascade tile spans exactly `scale` meters (see worldToPixelCoords).
    // The cascade normal texture is mipmapped for the water surface, and the
    // `fract()` wrap makes UV derivatives jump at every tile boundary, which
    // sends hardware LOD selection to the coarsest mip along those seams.
    return textureLevel(
      this._normalTexture,
      vec2(
        fract(worldX.div(this._waveScale).add(0.5)),
        fract(worldZ.div(this._waveScale).add(0.5)),
      ),
      int(0),
    );
  }
}
