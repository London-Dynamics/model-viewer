/**
 * WebGL FFT wave simulation using render-to-texture ping-pong buffers.
 * This implementation replicates the WebGPU compute shader approach using fragment shaders.
 */

import * as THREE from "three/webgpu";
import {
  uniform,
  uniformArray,
  texture,
  vec2,
  vec3,
  float,
  fract,
} from "three/tsl";
import type { Node } from "three/webgpu";

import type {
  IWaveSimulation,
  InternalGerstnerParams,
  WaveCapabilities,
  WaveDisplacementNodes,
  WaveNormalNodes,
} from "../IWaveSimulation";
import type { CascadeConfig, CascadesConfig } from "../types";
import type { TSLBuffer, TSLUniformNode } from "../../../types/tsl";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { CascadeSimulationUniforms, type WaveUniforms } from "../../../uniforms";
import { getCascadeConfigsArray } from "../types";
import { WAVE_TIME_OMEGA_STEP } from "../timing";
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

  // Gerstner wave resources
  private _gerstnerMaxWaves: number;
  private _gerstnerWaveBuffer: Node | null = null;
  private _gerstnerWaveCount = uniform(0);
  private _timeUniform = uniform(0);

  // TSL texture nodes for sampling in materials

  constructor(
    renderer: THREE.WebGPURenderer,
    options: WebGLWaveSimulationOptions,
  ) {
    this.renderer = renderer;
    this._waveUniforms = options.waveUniforms;
    this._foamWindBias = options.foamWindBias;
    this._gerstnerMaxWaves = options.qualityConfig.gerstnerMaxWaves;
    this._seed = options.seed;

    // Gerstner wave buffer
    if (this._gerstnerMaxWaves > 0) {
      this._gerstnerWaveBuffer = uniformArray(
        Array.from(
          { length: this._gerstnerMaxWaves * 2 },
          () => new THREE.Vector4(),
        ),
        "vec4",
      );
    }

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
      hasJacobianFoam: true,
      hasPersistentFoamBuffer: false,
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

    const sampleNormalAndEigenvalue = (worldX: Node, worldZ: Node) => {
      let blendedNormal: Node = vec3(0, 1, 0);
      // Per-cascade eigenvalues kept separate so foam can weight wave folding
      // (cascade 0) and ripple folding (cascade 1) independently. Neutral 1.0
      // means "no folding" for any cascade the quality level disabled.
      let eigen0: Node = float(1.0);
      let eigen1: Node = float(1.0);

      for (let i = 0; i < cascades.length; i++) {
        const cascade = cascades[i];
        const uv = this.worldToUV(worldX, worldZ, cascade);
        const normalTex = texture(cascade.normalTarget.texture);
        const sampled = normalTex.sample(uv);
        const normal = sampled.xyz.mul(2.0).sub(1.0);

        if (i === 0) {
          blendedNormal = normal;
          eigen0 = sampled.w;
        } else {
          // RNM blending
          blendedNormal = vec3(
            blendedNormal.x.add(normal.x),
            blendedNormal.y.add(normal.y.sub(1.0)),
            blendedNormal.z.add(normal.z),
          );
          eigen1 = sampled.w;
        }
      }

      return { normal: blendedNormal.normalize(), eigen0, eigen1 };
    };

    return { sampleNormal, sampleNormalAndEigenvalue };
  }

  /** Convert world coordinates to UV for a cascade's texture. */
  private worldToUV(worldX: Node, worldZ: Node, cascade: CascadeLevel): Node {
    const resolution = float(cascade.resolution);
    const baseRes = float(256.0);
    const effectiveScale = cascade.uniforms.scale.mul(resolution).div(baseRes);

    const uvX = fract(worldX.div(effectiveScale).add(0.5));
    const uvZ = fract(worldZ.div(effectiveScale).add(0.5));
    return vec2(uvX, uvZ);
  }

  // ============================================
  // Cascade Management
  // ============================================

  private initCascades(
    cascadesConfig: CascadesConfig,
    qualityConfig: QualityLevelConfig,
  ): void {
    const presetConfigs = getCascadeConfigsArray(cascadesConfig);
    const qualityCascades = qualityConfig.cascades;

    let cascadeIndex = 0;
    for (let i = 0; i < presetConfigs.length; i++) {
      const qualityCascade = qualityCascades[i];
      if (!qualityCascade?.enabled) continue;

      const cascade = this.createCascade(
        presetConfigs[i],
        qualityCascade.resolution,
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
  ): THREE.RenderTarget {
    const filter = useNearestFilter ? THREE.NearestFilter : THREE.LinearFilter;
    return new THREE.RenderTarget(resolution, resolution, {
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      format: THREE.RGBAFormat,
      type,
      depthBuffer: false,
    });
  }

  private createCascade(
    config: CascadeConfig,
    resolution: number,
    cascadeIndex: number,
  ): CascadeLevel {
    const { scale, amplitudeScale } = config;
    const numBits = Math.log2(resolution);

    // Create cascade uniforms (shared with all shaders for this cascade)
    const cascadeUniforms = new CascadeSimulationUniforms();
    cascadeUniforms.init(resolution, scale, amplitudeScale);
    // Decorrelate cascades by offsetting the root seed. The spectrum shader
    // multiplies randomSeed by 100000, so a +1 offset moves cells far apart
    // in the hash domain (see spectrum.ts).
    cascadeUniforms.randomSeed.value = this._seed + cascadeIndex;

    // Create render targets
    const h0Target = this.createRenderTarget(resolution, THREE.FloatType, true);
    const displacementTarget = this.createRenderTarget(resolution);
    const normalTarget = this.createRenderTarget(resolution);

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
    this._timeUniform.value = this.time;

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
    assignCascadeBands(this.cascades.map((c) => c.uniforms), this._waveUniforms);
    this._waveUniforms.bandDirty = false;
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

    if (this._waveUniforms.bandDirty) {
      assignCascadeBands(this.cascades.map((c) => c.uniforms), this._waveUniforms);
      this._waveUniforms.bandDirty = false;
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

  public getDisplacementBuffer(_cascadeIndex?: number): TSLBuffer | null {
    return null;
  }

  public getNormalBuffer(_cascadeIndex?: number): TSLBuffer | null {
    return null;
  }

  public getResolution(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.resolution ?? 256;
  }

  public getScale(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.uniforms.scale.value ?? 100;
  }

  public updateCascadeConfig(index: number, config: CascadeConfig): void {
    if (index >= this.cascades.length) return;

    const cascade = this.cascades[index];
    cascade.uniforms.updateCascadeConfig(config.scale, config.amplitudeScale);
    cascade.initialized = false;
    assignCascadeBands(this.cascades.map((c) => c.uniforms), this._waveUniforms);
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

  // ============================================
  // Gerstner Wave Access
  // ============================================

  public getGerstnerWaveBuffer(): Node | null {
    return this._gerstnerWaveBuffer;
  }

  public getGerstnerWaveCountUniform(): Node | null {
    return this._gerstnerMaxWaves > 0 ? this._gerstnerWaveCount : null;
  }

  public getGerstnerMaxWaves(): number {
    return this._gerstnerMaxWaves;
  }

  public getTimeUniform(): Node | null {
    return this._timeUniform;
  }

  public getGerstnerCPUState(): {
    waveData: THREE.Vector4[] | null;
    waveCount: number;
    time: number;
  } {
    if (!this._gerstnerWaveBuffer || this._gerstnerMaxWaves === 0) {
      return { waveData: null, waveCount: 0, time: this.time };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = this._gerstnerWaveBuffer as any;
    return {
      waveData: buf.array as THREE.Vector4[],
      waveCount: this._gerstnerWaveCount.value,
      time: this.time,
    };
  }

  public updateGerstnerParams(params: InternalGerstnerParams): void {
    if (!this._gerstnerWaveBuffer || this._gerstnerMaxWaves === 0) return;

    const maxWaves = this._gerstnerMaxWaves;
    const waveCount = maxWaves;
    const gravity = this._waveUniforms.gravity.value;

    const effectiveSpread =
      waveCount > 1
        ? Math.pow(params.wavelengthSpread, 2 / (waveCount - 1))
        : 1.0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = this._gerstnerWaveBuffer as any;
    for (let i = 0; i < waveCount; i++) {
      const centerIndex = (waveCount - 1) / 2;
      const exponent = i - centerIndex;
      const wavelength =
        params.wavelength * Math.pow(effectiveSpread, exponent);

      let direction = params.direction;
      if (waveCount > 1) {
        const t = i / (waveCount - 1) - 0.5;
        direction = params.direction + t * params.directionalSpread;
      }

      const dirX = Math.cos(direction);
      const dirZ = Math.sin(direction);

      const sigma = waveCount / 3;
      const taper = Math.exp((-0.5 * exponent * exponent) / (sigma * sigma));
      const amplitude = params.amplitude * taper;

      const steepness = params.steepness;
      const k = (2 * Math.PI) / wavelength;
      // Snap to the wave-sim loop period (see WebGPU sibling for rationale).
      const omegaNatural = Math.sqrt(gravity * k);
      const omega =
        Math.round(omegaNatural / WAVE_TIME_OMEGA_STEP) * WAVE_TIME_OMEGA_STEP;
      const phaseOffset = (i * 137.5) % (2 * Math.PI);

      buf.array[i * 2].set(dirX, dirZ, amplitude, wavelength);
      buf.array[i * 2 + 1].set(steepness, phaseOffset, omega, 0);
    }
    buf.needsUpdate = true;

    this._gerstnerWaveCount.value = waveCount;
  }
}
