// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * WebGL FFT wave simulation using render-to-texture ping-pong buffers.
 * This implementation replicates the WebGPU compute shader approach using fragment shaders.
 */

import * as THREE from "three/webgpu";
import {
  texture,
  vec2,
  vec3,
  fract,
} from "three/tsl";
import type { Node } from "three/webgpu";

import type {
  IWaveSimulation,
  WaveCapabilities,
  WaveDisplacementNodes,
  WaveNormalNodes,
} from "../IWaveSimulation";
import type { CascadesConfig } from "../types";
import type { TSLBuffer, TSLUniformNode } from "../../../types/tsl";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { CascadeSimulationUniforms, type WaveUniforms } from "../../../uniforms";
import { deriveCascadeScale } from "../types";
import { assignCascadeBands } from "../cascadeBands";

import {
  createInitSpectrumMaterial,
  createTimeEvolutionMaterial,
  type TimeEvolutionMaterialResult,
} from "./shaders/spectrum";
import {
  createFFTHorizontalMaterial,
  createFFTVerticalMaterial,
  createFFTNormalizeMaterial,
  type FFTButterflyMaterialResult,
  type FFTNormalizeMaterialResult,
} from "./shaders/fft";
import {
  createNormalsMaterial,
  type NormalsMaterialResult,
} from "./shaders/computeNormals";

/** Internal structure for a single cascade's GPU resources */
interface CascadeLevel {
  uniforms: CascadeSimulationUniforms;
  resolution: number;
  numBits: number;

  // Render targets
  h0Target: THREE.RenderTarget;
  displacementTarget: THREE.RenderTarget;
  normalTarget: THREE.RenderTarget;

  // Time evolution output targets (preserved for debug visualization)
  timeEvoDx: THREE.RenderTarget;
  timeEvoDy: THREE.RenderTarget;
  timeEvoDz: THREE.RenderTarget;

  // FFT ping-pong targets for each component (Dx, Dy, Dz)
  fftPingDx: THREE.RenderTarget;
  fftPongDx: THREE.RenderTarget;
  fftPingDy: THREE.RenderTarget;
  fftPongDy: THREE.RenderTarget;
  fftPingDz: THREE.RenderTarget;
  fftPongDz: THREE.RenderTarget;

  // Materials
  initSpectrumMaterial: THREE.MeshBasicNodeMaterial;
  timeEvolutionDx: TimeEvolutionMaterialResult;
  timeEvolutionDy: TimeEvolutionMaterialResult;
  timeEvolutionDz: TimeEvolutionMaterialResult;
  fftHorizontal: FFTButterflyMaterialResult;
  fftVertical: FFTButterflyMaterialResult;
  fftNormalize: FFTNormalizeMaterialResult;
  normals: NormalsMaterialResult;

  // FFT result targets (set after each runFFT, may be ping or pong)
  fftResultDx: THREE.RenderTarget;
  fftResultDy: THREE.RenderTarget;
  fftResultDz: THREE.RenderTarget;

  // State
  initialized: boolean;
}

export interface WebGLWaveSimulationOptions {
  cascades: CascadesConfig;
  foamWindBias: TSLUniformNode;
  qualityConfig: QualityLevelConfig;
  /** Phillips spectrum seed. Cascade `i` uses `seed + i` for decorrelation. */
  seed: number;
  waveUniforms: WaveUniforms;
}

/**
 * WebGL FFT wave simulation using render-to-texture.
 * Provides physically-based wave simulation compatible with WebGL2.
 */
export class WebGLWaveSimulation implements IWaveSimulation {
  private cascades: CascadeLevel[] = [];
  private renderer: THREE.WebGPURenderer;
  private time: number = 0;
  private _explicitTimeThisFrame = false;
  private _seed: number;
  private _animationSpeed: number = 1.0;

  private _waveUniforms: WaveUniforms;
  private _foamWindBias: TSLUniformNode;

  // Full-screen quad for rendering
  private quadMesh: THREE.QuadMesh;

  constructor(
    renderer: THREE.WebGPURenderer,
    options: WebGLWaveSimulationOptions,
  ) {
    this.renderer = renderer;
    this._waveUniforms = options.waveUniforms;
    this._foamWindBias = options.foamWindBias;
    this._seed = options.seed;

    // Create full-screen quad for RTT passes
    this.quadMesh = new THREE.QuadMesh();

    this.initCascades(options.cascades, options.qualityConfig);
  }

  /**
   * Override the simulation's time accumulator with an absolute time.
   * Used by `WaterSystem.syncToTick` for multiplayer sync. The next
   * `update()` call drives the GPU using the new time without further
   * internal accumulation.
   */
  public setTime(t: number): void {
    this.time = t;
    this._explicitTimeThisFrame = true;
  }

  // ============================================
  // Properties
  // ============================================

  get animationSpeed(): number {
    return this._animationSpeed;
  }
  set animationSpeed(value: number) {
    this._animationSpeed = value;
  }

  // ============================================
  // IWaveSimulation Implementation
  // ============================================

  public getCapabilities(): WaveCapabilities {
    return {
      hasCascades: true,
      hasStorageBuffers: false,
      cascadeCount: this.cascades.length,
      backend: "webgl",
    };
  }

  public getDisplacementNodes(): WaveDisplacementNodes {
    const cascades = this.cascades;

    const sampleDisplacement = (worldX: Node, worldZ: Node): Node => {
      let totalDisp: Node = vec3(0, 0, 0);

      for (let i = 0; i < cascades.length; i++) {
        const cascade = cascades[i];
        const uv = this.worldToUV(worldX, worldZ, cascade);
        const displacementTex = texture(cascade.displacementTarget.texture);
        const disp = displacementTex.sample(uv);

        totalDisp = vec3(
          totalDisp.x.add(disp.x),
          totalDisp.y.add(disp.y),
          totalDisp.z.add(disp.z),
        );
      }

      return totalDisp;
    };

    return { sampleDisplacement };
  }

  public getNormalNodes(): WaveNormalNodes {
    const cascades = this.cascades;

    const sampleNormal = (worldX: Node, worldZ: Node): Node => {
      let blendedNormal: Node = vec3(0, 1, 0);

      for (let i = 0; i < cascades.length; i++) {
        const cascade = cascades[i];
        const uv = this.worldToUV(worldX, worldZ, cascade);
        const normalTex = texture(cascade.normalTarget.texture);
        const n = normalTex.sample(uv);
        const normal = n.xyz.mul(2.0).sub(1.0);

        if (i === 0) {
          blendedNormal = normal;
        } else {
          // RNM blending
          blendedNormal = vec3(
            blendedNormal.x.add(normal.x),
            blendedNormal.y.add(normal.y.sub(1.0)),
            blendedNormal.z.add(normal.z),
          );
        }
      }

      return blendedNormal.normalize();
    };

    return { sampleNormal };
  }

  /** Convert world coordinates to UV for a cascade's texture. */
  private worldToUV(worldX: Node, worldZ: Node, cascade: CascadeLevel): Node {
    // Tile size is the cascade's world-space scale (matches spectrum.ts).
    const scale = cascade.uniforms.scale;
    const uvX = fract(worldX.div(scale).add(0.5));
    const uvZ = fract(worldZ.div(scale).add(0.5));
    return vec2(uvX, uvZ);
  }

  // ============================================
  // Cascade Management
  // ============================================

  private initCascades(
    cascadesConfig: CascadesConfig,
    qualityConfig: QualityLevelConfig,
  ): void {
    const qualityCascades = qualityConfig.cascades;
    const resolutions = qualityCascades
      .filter((c) => c?.enabled)
      .map((c) => c.resolution);

    let cascadeIndex = 0;
    for (let i = 0; i < qualityCascades.length; i++) {
      const qualityCascade = qualityCascades[i];
      if (!qualityCascade?.enabled) continue;

      const cascade = this.createCascade(
        cascadesConfig.maxScale,
        resolutions,
        cascadeIndex,
      );
      this.cascades.push(cascade);
      cascadeIndex++;
    }
  }

  private createRenderTarget(
    resolution: number,
    type: THREE.TextureDataType = THREE.FloatType,
    useNearestFilter: boolean = false,
    mipmaps: boolean = false,
  ): THREE.RenderTarget {
    const filter = useNearestFilter ? THREE.NearestFilter : THREE.LinearFilter;
    return new THREE.RenderTarget(resolution, resolution, {
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : filter,
      magFilter: filter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      format: THREE.RGBAFormat,
      type,
      depthBuffer: false,
      generateMipmaps: mipmaps,
      anisotropy: mipmaps ? 8 : 1,
    });
  }

  private createCascade(
    maxScale: number,
    resolutions: number[],
    cascadeIndex: number,
  ): CascadeLevel {
    const resolution = resolutions[cascadeIndex];
    const scale = deriveCascadeScale(maxScale, resolutions, cascadeIndex);
    const numBits = Math.log2(resolution);

    // Create cascade uniforms (shared with all shaders for this cascade)
    const cascadeUniforms = new CascadeSimulationUniforms();
    cascadeUniforms.init(resolution, scale);
    // Decorrelate cascades by offsetting the root seed. The spectrum shader
    // multiplies randomSeed by 100000, so a +1 offset moves cells far apart
    // in the hash domain (see spectrum.ts).
    cascadeUniforms.randomSeed.value = this._seed + cascadeIndex;

    // Create render targets
    const h0Target = this.createRenderTarget(resolution, THREE.FloatType, true);
    const displacementTarget = this.createRenderTarget(resolution);
    // Trilinear + anisotropic sampling band-limits the normals to the pixel
    // footprint: averaging encoded normals cancels sub-pixel wave phases
    // toward flat, so distant water stops shimmering while resolved
    // wavelengths survive to the horizon. Matches the WebGPU compute path's
    // normal StorageTexture (WebGPUWaveSimulation.ts).
    const normalTarget = this.createRenderTarget(
      resolution,
      THREE.FloatType,
      false,
      true,
    );

    const timeEvoDx = this.createRenderTarget(resolution, THREE.FloatType, true);
    const timeEvoDy = this.createRenderTarget(resolution, THREE.FloatType, true);
    const timeEvoDz = this.createRenderTarget(resolution, THREE.FloatType, true);

    const fftPingDx = this.createRenderTarget(resolution, THREE.FloatType, true);
    const fftPongDx = this.createRenderTarget(resolution, THREE.FloatType, true);
    const fftPingDy = this.createRenderTarget(resolution, THREE.FloatType, true);
    const fftPongDy = this.createRenderTarget(resolution, THREE.FloatType, true);
    const fftPingDz = this.createRenderTarget(resolution, THREE.FloatType, true);
    const fftPongDz = this.createRenderTarget(resolution, THREE.FloatType, true);

    // Create materials — all share the same wave + cascade uniform nodes
    const initSpectrumMaterial = createInitSpectrumMaterial({
      wave: this._waveUniforms,
      cascade: cascadeUniforms,
    });

    const timeEvolutionDx = createTimeEvolutionMaterial({
      wave: this._waveUniforms,
      cascade: cascadeUniforms,
      numBits,
      component: 1,
    });

    const timeEvolutionDy = createTimeEvolutionMaterial({
      wave: this._waveUniforms,
      cascade: cascadeUniforms,
      numBits,
      component: 0,
    });

    const timeEvolutionDz = createTimeEvolutionMaterial({
      wave: this._waveUniforms,
      cascade: cascadeUniforms,
      numBits,
      component: 2,
    });

    const fftHorizontal = createFFTHorizontalMaterial({ cascade: cascadeUniforms });
    const fftVertical = createFFTVerticalMaterial({ cascade: cascadeUniforms });
    const fftNormalize = createFFTNormalizeMaterial({
      wave: this._waveUniforms,
      cascade: cascadeUniforms,
    });
    const normals = createNormalsMaterial({
      wave: this._waveUniforms,
      foamWindBias: this._foamWindBias,
      cascade: cascadeUniforms,
    });

    return {
      uniforms: cascadeUniforms,
      resolution,
      numBits,
      h0Target,
      displacementTarget,
      normalTarget,
      timeEvoDx,
      timeEvoDy,
      timeEvoDz,
      fftPingDx,
      fftPongDx,
      fftPingDy,
      fftPongDy,
      fftPingDz,
      fftPongDz,
      initSpectrumMaterial,
      timeEvolutionDx,
      timeEvolutionDy,
      timeEvolutionDz,
      fftHorizontal,
      fftVertical,
      fftNormalize,
      normals,
      fftResultDx: fftPingDx,
      fftResultDy: fftPingDy,
      fftResultDz: fftPingDz,
      initialized: false,
    };
  }

  private renderToTarget(
    material: THREE.Material,
    target: THREE.RenderTarget,
  ): void {
    this.quadMesh.material = material;

    const currentTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.quadMesh.render(this.renderer);
    this.renderer.setRenderTarget(currentTarget);
  }

  private runFFT(
    cascade: CascadeLevel,
    pingTarget: THREE.RenderTarget,
    pongTarget: THREE.RenderTarget,
  ): THREE.RenderTarget {
    const { fftHorizontal, fftVertical } = cascade;
    let currentSource = pingTarget;
    let currentDest = pongTarget;

    // Horizontal passes
    for (let stage = 0; stage < cascade.numBits; stage++) {
      cascade.uniforms.fftStage.value = stage;
      fftHorizontal.srcTextureNode.value = currentSource.texture;
      this.renderToTarget(fftHorizontal.material, currentDest);

      const temp = currentSource;
      currentSource = currentDest;
      currentDest = temp;
    }

    // Vertical passes
    for (let stage = 0; stage < cascade.numBits; stage++) {
      cascade.uniforms.fftStage.value = stage;
      fftVertical.srcTextureNode.value = currentSource.texture;
      this.renderToTarget(fftVertical.material, currentDest);

      const temp = currentSource;
      currentSource = currentDest;
      currentDest = temp;
    }

    return currentSource;
  }

  private updateCascade(cascade: CascadeLevel): void {
    // Update time on cascade uniforms (single source of truth)
    cascade.uniforms.time.value = this.time;

    // Initialize spectrum if needed
    if (!cascade.initialized) {
      this.renderToTarget(cascade.initSpectrumMaterial, cascade.h0Target);
      cascade.initialized = true;
    }

    // Time evolution — render to dedicated targets (debug) and FFT ping targets
    const { timeEvolutionDx, timeEvolutionDy, timeEvolutionDz } = cascade;

    timeEvolutionDy.h0TextureNode.value = cascade.h0Target.texture;
    this.renderToTarget(timeEvolutionDy.material, cascade.timeEvoDy);
    this.renderToTarget(timeEvolutionDy.material, cascade.fftPingDy);

    timeEvolutionDx.h0TextureNode.value = cascade.h0Target.texture;
    this.renderToTarget(timeEvolutionDx.material, cascade.timeEvoDx);
    this.renderToTarget(timeEvolutionDx.material, cascade.fftPingDx);

    timeEvolutionDz.h0TextureNode.value = cascade.h0Target.texture;
    this.renderToTarget(timeEvolutionDz.material, cascade.timeEvoDz);
    this.renderToTarget(timeEvolutionDz.material, cascade.fftPingDz);

    // Run FFT for each component
    const fftResultDy = this.runFFT(cascade, cascade.fftPingDy, cascade.fftPongDy);
    const fftResultDx = this.runFFT(cascade, cascade.fftPingDx, cascade.fftPongDx);
    const fftResultDz = this.runFFT(cascade, cascade.fftPingDz, cascade.fftPongDz);

    // Track which buffer holds the FFT result
    cascade.fftResultDy = fftResultDy;
    cascade.fftResultDx = fftResultDx;
    cascade.fftResultDz = fftResultDz;

    // Normalize and combine into displacement
    cascade.fftNormalize.fftDxTextureNode.value = fftResultDx.texture;
    cascade.fftNormalize.fftDyTextureNode.value = fftResultDy.texture;
    cascade.fftNormalize.fftDzTextureNode.value = fftResultDz.texture;
    this.renderToTarget(cascade.fftNormalize.material, cascade.displacementTarget);

    // Compute normals
    cascade.normals.displacementTextureNode.value = cascade.displacementTarget.texture;
    this.renderToTarget(cascade.normals.material, cascade.normalTarget);
  }

  // ============================================
  // Lifecycle
  // ============================================

  public init(): void {
    assignCascadeBands(this.cascades.map((c) => c.uniforms));
  }

  public async initializeBuffers(
    _renderer: THREE.WebGPURenderer,
  ): Promise<void> {
    this.time += 0.016 * this._animationSpeed;

    for (const cascade of this.cascades) {
      this.updateCascade(cascade);
    }
  }

  public update(deltaTime: number = 0.016): void {
    if (this._explicitTimeThisFrame) {
      this._explicitTimeThisFrame = false;
    } else {
      this.time += deltaTime * this._animationSpeed;
    }

    if (this._waveUniforms.dirty) {
      for (const cascade of this.cascades) {
        cascade.initialized = false;
      }
      this._waveUniforms.dirty = false;
    }

    for (const cascade of this.cascades) {
      this.updateCascade(cascade);
    }
  }

  public dispose(): void {
    for (const cascade of this.cascades) {
      cascade.h0Target.dispose();
      cascade.displacementTarget.dispose();
      cascade.normalTarget.dispose();
      cascade.timeEvoDx.dispose();
      cascade.timeEvoDy.dispose();
      cascade.timeEvoDz.dispose();
      cascade.fftPingDx.dispose();
      cascade.fftPongDx.dispose();
      cascade.fftPingDy.dispose();
      cascade.fftPongDy.dispose();
      cascade.fftPingDz.dispose();
      cascade.fftPongDz.dispose();
      cascade.initSpectrumMaterial.dispose();
      cascade.timeEvolutionDx.material.dispose();
      cascade.timeEvolutionDy.material.dispose();
      cascade.timeEvolutionDz.material.dispose();
      cascade.fftHorizontal.material.dispose();
      cascade.fftVertical.material.dispose();
      cascade.fftNormalize.material.dispose();
      cascade.normals.material.dispose();
    }
    this.cascades = [];
  }

  // ============================================
  // Cascade Access
  // ============================================

  public getCascadeCount(): number {
    return this.cascades.length;
  }

  public getDisplacementBuffer(_cascadeIndex?: number): TSLBuffer | null {
    return null;
  }

  public getResolution(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.resolution ?? 256;
  }

  public getScale(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.uniforms.scale.value ?? 100;
  }

  /**
   * Get a cascade's world-space scale uniform node (the single source of truth
   * shared with the cascade's FFT/normal shaders). The persistent-foam field
   * sampler binds to it so its cascade-tiled world→UV mapping tracks the same
   * scale as the normal texture the inject pass reads.
   */
  public getScaleNode(cascadeIndex: number = 0): Node | null {
    return this.cascades[cascadeIndex]?.uniforms.scale ?? null;
  }

  public setMaxScale(maxScale: number): void {
    const resolutions = this.cascades.map((c) => c.uniforms.resolution.value);
    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];
      const scale = deriveCascadeScale(maxScale, resolutions, i);
      cascade.uniforms.setScale(scale);
      cascade.initialized = false;
    }
    assignCascadeBands(this.cascades.map((c) => c.uniforms));
  }

  // ============================================
  // Texture Access (WebGL-specific)
  // ============================================

  /** Get the displacement texture for a cascade. */
  public getDisplacementTexture(
    cascadeIndex: number = 0,
  ): THREE.Texture | null {
    return this.cascades[cascadeIndex]?.displacementTarget.texture ?? null;
  }

  /** Get the normal texture for a cascade. */
  public getNormalTexture(cascadeIndex: number = 0): THREE.Texture | null {
    return this.cascades[cascadeIndex]?.normalTarget.texture ?? null;
  }

  /** Get the displacement render target for CPU readback. */
  public getDisplacementRenderTarget(
    cascadeIndex: number = 0,
  ): THREE.RenderTarget | null {
    return this.cascades[cascadeIndex]?.displacementTarget ?? null;
  }

  /** Get the normal render target for CPU readback. */
  public getNormalRenderTarget(
    cascadeIndex: number = 0,
  ): THREE.RenderTarget | null {
    return this.cascades[cascadeIndex]?.normalTarget ?? null;
  }

}
