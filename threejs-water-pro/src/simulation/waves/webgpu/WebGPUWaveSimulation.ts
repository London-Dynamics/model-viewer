import * as THREE from "three/webgpu";
import { instancedArray, uniformArray, uniform, storage, float, int, floor, mix, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

import type { TSLBuffer, TSLComputeShader } from "../../../types/tsl";
import type {
  IWaveSimulation,
  InternalGerstnerParams,
  WaveCapabilities,
  WaveDisplacementNodes,
  WaveNormalNodes,
} from "../IWaveSimulation";
import type { CascadeConfig, CascadesConfig } from "../types";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { CascadeSimulationUniforms, type WaveUniforms } from "../../../uniforms";
import type { TSLUniformNode } from "../../../types/tsl";
import { getCascadeConfigsArray } from "../types";
import { assignCascadeBands } from "../cascadeBands";
import { WAVE_TIME_OMEGA_STEP } from "../timing";
import {
  createInitSpectrumShader,
  createTimeEvolutionShader,
} from "./shaders/spectrum";
import { createNormalsShader } from "./shaders/computeNormals";
import { createVelocityShader } from "./shaders/computeVelocity";
import {
  createCombinedFFTHorizontalShader,
  createCombinedFFTVerticalShader,
  createCombinedFFTNormalizeShader,
} from "./shaders/fft";

export interface WebGPUWaveSimulationOptions {
  cascades: CascadesConfig;
  /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
  foamWindBias: TSLUniformNode;
  qualityConfig: QualityLevelConfig;
  /** Phillips spectrum seed. Cascade `i` uses `seed + i` for decorrelation. */
  seed: number;
  waveUniforms: WaveUniforms;
}

// Internal structure for a single cascade's GPU resources
interface CascadeLevel {
  resolution: number;
  numBits: number;
  scale: number;

  // Per-cascade uniforms (resolution, scale, time, fft state)
  uniforms: CascadeSimulationUniforms;

  // Storage buffers
  h0Buffer: TSLBuffer;
  displacementBuffer: TSLBuffer;
  prevDisplacementBuffer: TSLBuffer;
  velocityBuffer: TSLBuffer;
  normalBuffer: TSLBuffer;
  /**
   * StorageTexture mirror of `normalBuffer`, written alongside it by
   * `computeNormals`. Used by fragment-side consumers (cascade sampler,
   * caustics, sun shafts) so they sample via hardware bilinear instead
   * of doing manual 4-tap reads on a storage buffer.
   */
  normalTexture: THREE.StorageTexture;

  // FFT ping-pong buffers: 6 separate vec2 buffers (3 components × 2 for ping-pong)
  fftPingBufferDx: TSLBuffer;
  fftPongBufferDx: TSLBuffer;
  fftPingBufferDy: TSLBuffer;
  fftPongBufferDy: TSLBuffer;
  fftPingBufferDz: TSLBuffer;
  fftPongBufferDz: TSLBuffer;

  // Compute shaders
  computeInitSpectrum: TSLComputeShader;
  computeTimeEvolution: TSLComputeShader;
  computeNormals: TSLComputeShader;
  computeVelocity: TSLComputeShader;
  computeFFTHorizontalPingToPong: TSLComputeShader;
  computeFFTHorizontalPongToPing: TSLComputeShader;
  computeFFTVerticalPingToPong: TSLComputeShader;
  computeFFTVerticalPongToPing: TSLComputeShader;
  computeFFTNormalizePing: TSLComputeShader;
  computeFFTNormalizePong: TSLComputeShader;

  // State
  initialized: boolean;
}

/**
 * WebGPU wave simulation using FFT-based ocean modeling.
 * Provides high-quality, physically-based wave simulation with multiple cascades.
 */
export class WebGPUWaveSimulation implements IWaveSimulation {
  private cascades: CascadeLevel[] = [];
  private renderer: THREE.WebGPURenderer;
  private time: number = 0;
  private _explicitTimeThisFrame = false;
  private _seed: number;
  private _gerstnerMaxWaves: number;
  private _animationSpeed: number = 1.0;

  private _waveUniforms: WaveUniforms;
  private _foamWindBias: TSLUniformNode;

  private _gerstnerWaveBuffer: Node | null = null;
  private _gerstnerWaveCount = uniform(0);

  constructor(renderer: THREE.WebGPURenderer, options: WebGPUWaveSimulationOptions) {
    this.renderer = renderer;
    this._waveUniforms = options.waveUniforms;
    this._foamWindBias = options.foamWindBias;
    this._gerstnerMaxWaves = options.qualityConfig.gerstnerMaxWaves;
    this._seed = options.seed;

    // Allocate Gerstner wave buffer as uniformArray (UBO-based, works on both backends)
    if (this._gerstnerMaxWaves > 0) {
      this._gerstnerWaveBuffer = uniformArray(
        Array.from({ length: this._gerstnerMaxWaves * 2 }, () => new THREE.Vector4()),
        "vec4",
      );
    }

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
  // Gerstner Waves
  // ============================================

  /**
   * Update Gerstner wave parameters using auto-distribution.
   * Generates N wave descriptors from center wavelength, spread, direction, etc.
   * Arbitrary wavelengths and directions are supported since Gerstner waves are
   * evaluated analytically in the vertex shader (not on the FFT grid).
   */
  updateGerstnerParams(params: InternalGerstnerParams): void {
    if (!this._gerstnerWaveBuffer || this._gerstnerMaxWaves === 0) return;

    const maxWaves = this._gerstnerMaxWaves;
    const waveCount = maxWaves;
    const gravity = this._waveUniforms.gravity.value;

    // Compute effective spread to maintain constant wavelength range regardless of wave count.
    // wavelengthSpread defines the total range: [baseWavelength/spread, baseWavelength*spread]
    // With N waves, we need effectiveSpread^((N-1)/2) = spread, so effectiveSpread = spread^(2/(N-1))
    const effectiveSpread =
      waveCount > 1
        ? Math.pow(params.wavelengthSpread, 2 / (waveCount - 1))
        : 1.0;

    // Write per-wave data into the uniformArray (2 vec4s per wave)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = this._gerstnerWaveBuffer as any;
    for (let i = 0; i < waveCount; i++) {
      // Geometric distribution of wavelengths around center using effective spread
      const centerIndex = (waveCount - 1) / 2;
      const exponent = i - centerIndex;
      const wavelength =
        params.wavelength * Math.pow(effectiveSpread, exponent);

      // Direction distribution: evenly spread across directionalSpread
      let direction = params.direction;
      if (waveCount > 1) {
        const t = i / (waveCount - 1) - 0.5; // [-0.5, 0.5]
        direction = params.direction + t * params.directionalSpread;
      }

      const dirX = Math.cos(direction);
      const dirZ = Math.sin(direction);

      // Amplitude with Gaussian-like tapering from center (using original spread for taper shape)
      const sigma = waveCount / 3;
      const taper = Math.exp(-0.5 * (exponent * exponent) / (sigma * sigma));
      const amplitude = params.amplitude * taper;

      const steepness = params.steepness;

      // Deep water dispersion: omega = sqrt(g * k), snapped to the wave-sim
      // loop period so each Gerstner component completes an integer number
      // of cycles per `WAVE_TIME_PERIOD_SECONDS`. Per-wave perturbation is
      // at most π/period; for typical Gerstner omegas this is well under
      // 0.2%.
      const k = (2 * Math.PI) / wavelength;
      const omegaNatural = Math.sqrt(gravity * k);
      const omega =
        Math.round(omegaNatural / WAVE_TIME_OMEGA_STEP) * WAVE_TIME_OMEGA_STEP;

      // Deterministic phase offset per wave for variety
      const phaseOffset = ((i * 137.5) % (2 * Math.PI));

      // Pack into uniformArray: vec4(dirX, dirZ, amplitude, wavelength), vec4(steepness, phaseOffset, omega, 0)
      buf.array[i * 2].set(dirX, dirZ, amplitude, wavelength);
      buf.array[i * 2 + 1].set(steepness, phaseOffset, omega, 0);
    }
    buf.needsUpdate = true;

    this._gerstnerWaveCount.value = waveCount;
  }

  // ============================================
  // IWaveSimulation Implementation
  // ============================================

  public getCapabilities(): WaveCapabilities {
    return {
      hasCascades: true,
      hasStorageBuffers: true,
      hasJacobianFoam: true,
      hasPersistentFoamBuffer: true,
      cascadeCount: this.cascades.length,
      backend: "webgpu",
    };
  }

  public getDisplacementNodes(): WaveDisplacementNodes {
    const cascades = this.cascades;

    // Create TSL function that samples displacement from storage buffers
    const sampleDisplacement = (worldX: Node, worldZ: Node): Node => {
      // Sample each cascade and sum (simplified - actual impl uses hierarchical sampling)
      let totalDisp: Node = vec3(0, 0, 0);

      for (let i = 0; i < cascades.length; i++) {
        const cascade = cascades[i];
        const buffer = storage(cascade.displacementBuffer, "vec4", cascade.resolution * cascade.resolution);
        const resolution = float(cascade.resolution);
        const scale = float(cascade.scale);

        const disp = this.sampleBufferBilinear(worldX, worldZ, buffer, resolution, scale);
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
        const buffer = storage(cascade.normalBuffer, "vec4", cascade.resolution * cascade.resolution);
        const resolution = float(cascade.resolution);
        const scale = float(cascade.scale);

        const n = this.sampleBufferBilinear(worldX, worldZ, buffer, resolution, scale);
        // Normals stored in [0,1], convert to [-1,1]
        const normal = n.mul(2.0).sub(1.0);

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

  /**
   * Helper function for bilinear buffer sampling in TSL.
   */
  private sampleBufferBilinear(
    worldX: Node,
    worldZ: Node,
    buffer: ReturnType<typeof storage>,
    resolution: Node,
    scale: Node,
  ): Node {
    const baseRes = float(256.0);
    const effectiveScale = scale.mul(resolution).div(baseRes);

    const px = worldX.div(effectiveScale).add(0.5).mul(resolution);
    const py = worldZ.div(effectiveScale).add(0.5).mul(resolution);

    const x0Float = floor(px);
    const y0Float = floor(py);
    const fx = px.sub(x0Float);
    const fy = py.sub(y0Float);

    const res = int(resolution);
    const x0 = x0Float.toInt().mod(res).add(res).mod(res);
    const y0 = y0Float.toInt().mod(res).add(res).mod(res);
    const x1 = x0.add(1).mod(res);
    const y1 = y0.add(1).mod(res);

    const idx00 = y0.mul(res).add(x0);
    const idx10 = y0.mul(res).add(x1);
    const idx01 = y1.mul(res).add(x0);
    const idx11 = y1.mul(res).add(x1);

    const d00 = buffer.element(idx00).xyz;
    const d10 = buffer.element(idx10).xyz;
    const d01 = buffer.element(idx01).xyz;
    const d11 = buffer.element(idx11).xyz;

    const d0 = mix(d00, d10, fx);
    const d1 = mix(d01, d11, fx);
    return mix(d0, d1, fy);
  }

  // ============================================
  // Cascade Management
  // ============================================

  private initCascades(
    cascadesConfig: CascadesConfig,
    qualityConfig: QualityLevelConfig,
  ) {
    const presetConfigs = getCascadeConfigsArray(cascadesConfig);
    const qualityCascades = qualityConfig.cascades;

    let cascadeIndex = 0;
    for (let i = 0; i < presetConfigs.length; i++) {
      const qualityCascade = qualityCascades[i];
      if (!qualityCascade.enabled) continue;

      const cascade = this.createCascade(
        presetConfigs[i],
        qualityCascade.resolution,
        cascadeIndex,
      );
      this.cascades.push(cascade);
      cascadeIndex++;
    }
  }

  private createCascade(
    config: CascadeConfig,
    resolution: number,
    cascadeIndex: number,
  ): CascadeLevel {
    const { scale, amplitudeScale } = config;
    const numBits = Math.log2(resolution);
    const count = resolution * resolution;

    const uniforms = new CascadeSimulationUniforms();
    uniforms.init(resolution, scale, amplitudeScale);
    // Decorrelate cascades by offsetting the root seed. The spectrum shader
    // multiplies randomSeed by 100000, so a +1 offset moves cells far apart
    // in the hash domain (see spectrum.ts).
    uniforms.randomSeed.value = this._seed + cascadeIndex;

    const h0Buffer = instancedArray(count, "vec4");
    const displacementBuffer = instancedArray(count, "vec4");
    const prevDisplacementBuffer = instancedArray(count, "vec4");
    const velocityBuffer = instancedArray(count, "vec4");
    const normalBuffer = instancedArray(count, "vec4");
    const normalTexture = new THREE.StorageTexture(resolution, resolution);
    normalTexture.format = THREE.RGBAFormat;
    normalTexture.type = THREE.FloatType;
    normalTexture.magFilter = THREE.LinearFilter;
    normalTexture.minFilter = THREE.LinearFilter;
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;
    normalTexture.generateMipmaps = false;
    // `mipmapsAutoUpdate` skips the per-frame mipmap rebuild that
    // StorageTexture does by default after compute writes. The property
    // is missing from @types/three but is read by the WebGPU backend
    // (see renderers/webgpu/Textures: `skipAutoGeneration = isStorageTexture && mipmapsAutoUpdate === false`).
    (normalTexture as unknown as { mipmapsAutoUpdate: boolean }).mipmapsAutoUpdate = false;
    const fftPingBufferDx = instancedArray(count, "vec2");
    const fftPongBufferDx = instancedArray(count, "vec2");
    const fftPingBufferDy = instancedArray(count, "vec2");
    const fftPongBufferDy = instancedArray(count, "vec2");
    const fftPingBufferDz = instancedArray(count, "vec2");
    const fftPongBufferDz = instancedArray(count, "vec2");

    return {
      resolution,
      numBits,
      scale,
      uniforms,
      h0Buffer,
      displacementBuffer,
      prevDisplacementBuffer,
      velocityBuffer,
      normalBuffer,
      normalTexture,
      fftPingBufferDx,
      fftPongBufferDx,
      fftPingBufferDy,
      fftPongBufferDy,
      fftPingBufferDz,
      fftPongBufferDz,
      computeInitSpectrum: null as unknown as TSLComputeShader,
      computeTimeEvolution: null as unknown as TSLComputeShader,
      computeNormals: null as unknown as TSLComputeShader,
      computeVelocity: null as unknown as TSLComputeShader,
      computeFFTHorizontalPingToPong: null as unknown as TSLComputeShader,
      computeFFTHorizontalPongToPing: null as unknown as TSLComputeShader,
      computeFFTVerticalPingToPong: null as unknown as TSLComputeShader,
      computeFFTVerticalPongToPing: null as unknown as TSLComputeShader,
      computeFFTNormalizePing: null as unknown as TSLComputeShader,
      computeFFTNormalizePong: null as unknown as TSLComputeShader,
      initialized: false,
    };
  }

  private createComputeShadersForCascade(cascade: CascadeLevel): void {
    const { resolution, numBits, uniforms: cascadeUniforms } = cascade;
    const wave = this._waveUniforms;

    const pingBuffers = {
      dx: cascade.fftPingBufferDx,
      dy: cascade.fftPingBufferDy,
      dz: cascade.fftPingBufferDz,
    };
    const pongBuffers = {
      dx: cascade.fftPongBufferDx,
      dy: cascade.fftPongBufferDy,
      dz: cascade.fftPongBufferDz,
    };

    cascade.computeInitSpectrum = createInitSpectrumShader({
      wave,
      cascade: cascadeUniforms,
      h0Buffer: cascade.h0Buffer,
      resolution,
    });

    cascade.computeTimeEvolution = createTimeEvolutionShader({
      wave,
      cascade: cascadeUniforms,
      h0Buffer: cascade.h0Buffer,
      pingBuffers,
      resolution,
      numBits,
    });

    cascade.computeNormals = createNormalsShader({
      wave,
      foamWindBias: this._foamWindBias,
      cascade: cascadeUniforms,
      displacementBuffer: cascade.displacementBuffer,
      normalBuffer: cascade.normalBuffer,
      normalTexture: cascade.normalTexture,
      resolution,
    });

    cascade.computeVelocity = createVelocityShader({
      displacementBuffer: cascade.displacementBuffer,
      prevDisplacementBuffer: cascade.prevDisplacementBuffer,
      velocityBuffer: cascade.velocityBuffer,
      deltaTime: cascadeUniforms.deltaTime,
      resolution,
    });

    cascade.computeFFTHorizontalPingToPong = createCombinedFFTHorizontalShader({
      cascade: cascadeUniforms,
      srcBuffers: pingBuffers,
      dstBuffers: pongBuffers,
      resolution,
    });

    cascade.computeFFTHorizontalPongToPing = createCombinedFFTHorizontalShader({
      cascade: cascadeUniforms,
      srcBuffers: pongBuffers,
      dstBuffers: pingBuffers,
      resolution,
    });

    cascade.computeFFTVerticalPingToPong = createCombinedFFTVerticalShader({
      cascade: cascadeUniforms,
      srcBuffers: pingBuffers,
      dstBuffers: pongBuffers,
      resolution,
    });

    cascade.computeFFTVerticalPongToPing = createCombinedFFTVerticalShader({
      cascade: cascadeUniforms,
      srcBuffers: pongBuffers,
      dstBuffers: pingBuffers,
      resolution,
    });

    cascade.computeFFTNormalizePing = createCombinedFFTNormalizeShader({
      wave,
      cascade: cascadeUniforms,
      fftBuffers: pingBuffers,
      displacementBuffer: cascade.displacementBuffer,
      resolution,
    });

    cascade.computeFFTNormalizePong = createCombinedFFTNormalizeShader({
      wave,
      cascade: cascadeUniforms,
      fftBuffers: pongBuffers,
      displacementBuffer: cascade.displacementBuffer,
      resolution,
    });
  }

  public init() {
    assignCascadeBands(this.cascades.map((c) => c.uniforms), this._waveUniforms);
    this._waveUniforms.bandDirty = false;
    for (let i = 0; i < this.cascades.length; i++) {
      this.createComputeShadersForCascade(this.cascades[i]);
    }
  }

  public async update(deltaTime: number = 0.016): Promise<void> {
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
      cascade.uniforms.deltaTime.value = deltaTime;
      await this.queueCascadeUpdate(cascade);
    }
  }

  private async queueCascadeUpdate(cascade: CascadeLevel): Promise<void> {
    cascade.uniforms.time.value = this.time;

    if (!cascade.initialized) {
      await this.renderer.computeAsync(cascade.computeInitSpectrum);
      cascade.initialized = true;
    }

    await this.renderer.computeAsync(cascade.computeTimeEvolution);
    await this.queueIFFT2DForCascadeAsync(cascade);

    // Velocity runs AFTER FFT normalize (consumes fresh displacement) and
    // BEFORE normals — normals don't depend on velocity, so ordering is only
    // about reading the freshly-written displacementBuffer before anything
    // else overwrites it.
    await this.renderer.computeAsync(cascade.computeVelocity);
    await this.renderer.computeAsync(cascade.computeNormals);
  }

  private *getIFFT2DShaders(cascade: CascadeLevel): Generator<TSLComputeShader> {
    let dataInPing = true;

    for (let stage = 0; stage < cascade.numBits; stage++) {
      cascade.uniforms.fftStage.value = stage;
      yield dataInPing
        ? cascade.computeFFTHorizontalPingToPong
        : cascade.computeFFTHorizontalPongToPing;
      dataInPing = !dataInPing;
    }

    for (let stage = 0; stage < cascade.numBits; stage++) {
      cascade.uniforms.fftStage.value = stage;
      yield dataInPing
        ? cascade.computeFFTVerticalPingToPong
        : cascade.computeFFTVerticalPongToPing;
      dataInPing = !dataInPing;
    }

    yield dataInPing
      ? cascade.computeFFTNormalizePing
      : cascade.computeFFTNormalizePong;
  }

  private async queueIFFT2DForCascadeAsync(cascade: CascadeLevel): Promise<void> {
    for (const shader of this.getIFFT2DShaders(cascade)) {
      await this.renderer.computeAsync(shader);
    }
  }

  public updateCascadeConfig(index: number, config: CascadeConfig) {
    if (index >= this.cascades.length) return;

    const cascade = this.cascades[index];
    cascade.uniforms.updateCascadeConfig(config.scale, config.amplitudeScale);
    cascade.scale = config.scale;
    cascade.initialized = false;
    // Cascade scale changed → band edges shift and the compensation integral
    // changes; recompute across all cascades since neighbor crossovers depend
    // on this one.
    assignCascadeBands(this.cascades.map((c) => c.uniforms), this._waveUniforms);
  }

  // ============================================
  // Buffer Access
  // ============================================

  public getCascadeCount(): number {
    return this.cascades.length;
  }

  public getDisplacementBuffer(cascadeIndex: number = 0): TSLBuffer | null {
    return this.cascades[cascadeIndex]?.displacementBuffer ?? null;
  }

  public getNormalBuffer(cascadeIndex: number = 0): TSLBuffer | null {
    return this.cascades[cascadeIndex]?.normalBuffer ?? null;
  }

  /**
   * Per-texel surface velocity (m/s) for a cascade, computed as
   * `(currentDisplacement - previousDisplacement) / deltaTime`. Same layout
   * as the displacement buffer; `.xyz` is the velocity vector, `.w` unused.
   */
  public getVelocityBuffer(cascadeIndex: number = 0): TSLBuffer | null {
    return this.cascades[cascadeIndex]?.velocityBuffer ?? null;
  }

  public getNormalTexture(cascadeIndex: number = 0): THREE.Texture | null {
    return this.cascades[cascadeIndex]?.normalTexture ?? null;
  }

  public getResolution(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.resolution ?? 256;
  }

  public getScale(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.scale ?? 100;
  }

  public getCascadeScales(): number[] {
    return this.cascades.map((c) => c.scale);
  }

  public getCascadeResolutions(): number[] {
    return this.cascades.map((c) => c.resolution);
  }

  // ============================================
  // Gerstner Wave Access (IWaveSimulation)
  // ============================================

  public getGerstnerWaveBuffer(): Node | null {
    return this._gerstnerWaveBuffer;
  }

  public getGerstnerMaxWaves(): number {
    return this._gerstnerMaxWaves;
  }

  public getGerstnerWaveCountUniform(): Node | null {
    return this._gerstnerMaxWaves > 0 ? this._gerstnerWaveCount : null;
  }

  public getTimeUniform(): Node | null {
    return this.cascades[0]?.uniforms.time ?? null;
  }

  /**
   * Get Gerstner wave state for CPU-side evaluation.
   * Returns the wave buffer array, active wave count, blend factor, and current time.
   */
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

  public async initializeBuffers(renderer: THREE.WebGPURenderer): Promise<void> {
    this.time += 0.016 * this._animationSpeed;

    for (const cascade of this.cascades) {
      cascade.uniforms.time.value = this.time;
      cascade.uniforms.deltaTime.value = 0.016;

      if (!cascade.initialized) {
        await renderer.computeAsync(cascade.computeInitSpectrum);
        cascade.initialized = true;
      }

      await renderer.computeAsync(cascade.computeTimeEvolution);

      for (const shader of this.getIFFT2DShaders(cascade)) {
        await renderer.computeAsync(shader);
      }

      await renderer.computeAsync(cascade.computeVelocity);
      await renderer.computeAsync(cascade.computeNormals);
    }
  }

  public dispose(): void {
    this.cascades = [];
  }

}
