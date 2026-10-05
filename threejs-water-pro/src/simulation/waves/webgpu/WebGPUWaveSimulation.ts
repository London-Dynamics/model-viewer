// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { instancedArray, storage, float, int, floor, mix, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

import type { TSLBuffer, TSLComputeShader } from "../../../types/tsl";
import type {
  IWaveSimulation,
  WaveCapabilities,
  WaveDisplacementNodes,
  WaveNormalNodes,
} from "../IWaveSimulation";
import type { CascadesConfig } from "../types";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { CascadeSimulationUniforms, type WaveUniforms } from "../../../uniforms";
import type { TSLUniformNode } from "../../../types/tsl";
import { deriveCascadeScale } from "../types";
import { assignCascadeBands } from "../cascadeBands";
import {
  createInitSpectrumShader,
  createTimeEvolutionShader,
} from "./shaders/spectrum";
import { createNormalsShader } from "./shaders/computeNormals";
import { sampleNormalTexture } from "./shaders/sampleBuffers";
import {
  createCombinedFFTHorizontalShader,
  createCombinedFFTSharedHorizontalShader,
  createCombinedFFTSharedVerticalShader,
  createCombinedFFTVerticalShader,
  createCombinedFFTNormalizeShader,
} from "./shaders/fft";

/** Three vec2<f32> fields are resident in workgroup memory during a line FFT. */
const SHARED_FFT_BYTES_PER_ELEMENT = 3 * 2 * Float32Array.BYTES_PER_ELEMENT;

interface WebGPUComputeLimits {
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupStorageSize: number;
}

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
  /**
   * Authoritative RGBA16F normal/folding texture, written by `computeNormals`
   * and sampled by compute and fragment consumers via hardware filtering.
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
  /** Complete global-memory hot-path update, excluding spectrum init. */
  computeGlobalUpdate: TSLComputeShader[];
  /** Complete shared-memory update, or the global fallback when unsupported. */
  computeSharedUpdate: TSLComputeShader[];

  /** Whether this cascade can fuse each complete row/column FFT in workgroup memory. */
  supportsSharedMemoryFFT: boolean;

  // State
  initialized: boolean;
}

/**
 * WebGPU wave simulation using FFT-based ocean modeling.
 * Provides high-quality, physically-based wave simulation with multiple cascades.
 */
export class WebGPUWaveSimulation implements IWaveSimulation {
  private cascades: CascadeLevel[] = [];
  /** Persistent array identities let Three reuse both A/B compute-group states. */
  private computeGlobalUpdateGroup: TSLComputeShader[] = [];
  private computeGlobalInitializeAndUpdateGroup: TSLComputeShader[] = [];
  private computeSharedUpdateGroup: TSLComputeShader[] = [];
  private computeSharedInitializeAndUpdateGroup: TSLComputeShader[] = [];
  private renderer: THREE.WebGPURenderer;
  private time: number = 0;
  private _explicitTimeThisFrame = false;
  private _seed: number;
  private _animationSpeed: number = 1.0;
  private sharedMemoryFFTEnabled = true;

  private _waveUniforms: WaveUniforms;
  private _foamWindBias: TSLUniformNode;

  constructor(renderer: THREE.WebGPURenderer, options: WebGPUWaveSimulationOptions) {
    this.renderer = renderer;
    this._waveUniforms = options.waveUniforms;
    this._foamWindBias = options.foamWindBias;
    this._seed = options.seed;

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

  /** Whether at least one active cascade fits the device's workgroup limits. */
  private get sharedMemoryFFTSupported(): boolean {
    return this.cascades.some((cascade) => cascade.supportsSharedMemoryFFT);
  }

  // ============================================
  // IWaveSimulation Implementation
  // ============================================

  public getCapabilities(): WaveCapabilities {
    return {
      hasCascades: true,
      hasStorageBuffers: true,
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
        const resolution = float(cascade.resolution);
        const scale = float(cascade.scale);

        const normal = sampleNormalTexture(
          worldX,
          worldZ,
          cascade.normalTexture,
          resolution,
          scale,
        );

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
    // Tile size is the cascade's world-space scale (matches spectrum.ts).
    const px = worldX.div(scale).add(0.5).mul(resolution);
    const py = worldZ.div(scale).add(0.5).mul(resolution);

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
    const qualityCascades = qualityConfig.cascades;
    const resolutions = qualityCascades
      .filter((c) => c.enabled)
      .map((c) => c.resolution);

    let cascadeIndex = 0;
    for (let i = 0; i < qualityCascades.length; i++) {
      const qualityCascade = qualityCascades[i];
      if (!qualityCascade.enabled) continue;

      const cascade = this.createCascade(
        cascadesConfig.maxScale,
        resolutions,
        cascadeIndex,
      );
      this.cascades.push(cascade);
      cascadeIndex++;
    }
  }

  private createCascade(
    maxScale: number,
    resolutions: number[],
    cascadeIndex: number,
  ): CascadeLevel {
    const resolution = resolutions[cascadeIndex];
    const scale = deriveCascadeScale(maxScale, resolutions, cascadeIndex);
    const numBits = Math.log2(resolution);
    const count = resolution * resolution;

    const uniforms = new CascadeSimulationUniforms();
    uniforms.init(resolution, scale);
    // Decorrelate cascades by offsetting the root seed. The spectrum shader
    // multiplies randomSeed by 100000, so a +1 offset moves cells far apart
    // in the hash domain (see spectrum.ts).
    uniforms.randomSeed.value = this._seed + cascadeIndex;

    const h0Buffer = instancedArray(count, "vec4");
    const displacementBuffer = instancedArray(count, "vec4");
    const normalTexture = new THREE.StorageTexture(resolution, resolution);
    normalTexture.format = THREE.RGBAFormat;
    normalTexture.type = THREE.HalfFloatType;
    normalTexture.magFilter = THREE.LinearFilter;
    // Trilinear + anisotropic sampling band-limits the normals to the pixel
    // footprint: averaging encoded normals cancels sub-pixel wave phases
    // toward flat, so distant water stops shimmering while resolved
    // wavelengths survive to the horizon. The backend regenerates the mip
    // chain automatically after each compute write (`StorageTexture`
    // defaults `mipmapsAutoUpdate = true`); anisotropy keeps the cross-view
    // axis sharp at the grazing angles that dominate ocean viewing.
    normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    normalTexture.generateMipmaps = true;
    normalTexture.anisotropy = 8;
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;
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
      computeGlobalUpdate: [],
      computeSharedUpdate: [],
      supportsSharedMemoryFFT: false,
      initialized: false,
    };
  }

  /**
   * Read the initialized WebGPU device limits exposed by Three's backend.
   * Missing/non-WebGPU backend state conservatively selects the global FFT.
   */
  private getComputeLimits(): WebGPUComputeLimits | null {
    const backend = this.renderer.backend as unknown as {
      device?: { limits?: Partial<WebGPUComputeLimits> };
    };
    const limits = backend.device?.limits;
    if (
      limits?.maxComputeInvocationsPerWorkgroup === undefined ||
      limits.maxComputeWorkgroupSizeX === undefined ||
      limits.maxComputeWorkgroupStorageSize === undefined
    ) {
      return null;
    }

    return limits as WebGPUComputeLimits;
  }

  /**
   * A complete line uses R/2 pair owners and R × 24 bytes of shared storage.
   * The current global-memory implementation remains the correctness fallback.
   */
  private canUseSharedMemoryFFT(resolution: number): boolean {
    const limits = this.getComputeLimits();
    if (!limits) return false;

    const pairOwners = resolution / 2;
    const storageBytes = resolution * SHARED_FFT_BYTES_PER_ELEMENT;
    return (
      Number.isInteger(pairOwners) &&
      pairOwners <= limits.maxComputeInvocationsPerWorkgroup &&
      pairOwners <= limits.maxComputeWorkgroupSizeX &&
      storageBytes <= limits.maxComputeWorkgroupStorageSize
    );
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
      normalTexture: cascade.normalTexture,
      resolution,
    });

    const computeGlobalIFFT2D: TSLComputeShader[] = [];
    let dataInPing = true;

    for (let stage = 0; stage < numBits; stage++) {
      computeGlobalIFFT2D.push(
        createCombinedFFTHorizontalShader({
          cascade: cascadeUniforms,
          srcBuffers: dataInPing ? pingBuffers : pongBuffers,
          dstBuffers: dataInPing ? pongBuffers : pingBuffers,
          resolution,
          stage,
        }),
      );
      dataInPing = !dataInPing;
    }

    for (let stage = 0; stage < numBits; stage++) {
      computeGlobalIFFT2D.push(
        createCombinedFFTVerticalShader({
          cascade: cascadeUniforms,
          srcBuffers: dataInPing ? pingBuffers : pongBuffers,
          dstBuffers: dataInPing ? pongBuffers : pingBuffers,
          resolution,
          stage,
        }),
      );
      dataInPing = !dataInPing;
    }

    cascade.supportsSharedMemoryFFT = this.canUseSharedMemoryFFT(resolution);
    const computeSharedIFFT2D: TSLComputeShader[] = [];
    if (cascade.supportsSharedMemoryFFT) {
      // Time evolution writes ping. One workgroup then owns a whole row and a
      // whole column in turn, keeping every radix-2 stage in 3 × vec2 shared
      // arrays. The finished 2D transform returns to ping for normalization.
      computeSharedIFFT2D.push(
        createCombinedFFTSharedHorizontalShader({
          srcBuffers: pingBuffers,
          dstBuffers: pongBuffers,
          resolution,
        }),
        createCombinedFFTSharedVerticalShader({
          srcBuffers: pongBuffers,
          dstBuffers: pingBuffers,
          resolution,
        }),
      );
    } else {
      // Unsupported cascades keep the global algorithm even while the shared
      // path is enabled for smaller cascades.
      computeSharedIFFT2D.push(...computeGlobalIFFT2D);
    }

    const computeNormalize = createCombinedFFTNormalizeShader({
      wave,
      cascade: cascadeUniforms,
      // Both the shared path (ping → pong → ping) and the even number of
      // global horizontal + vertical stages finish in ping.
      fftBuffers: pingBuffers,
      displacementBuffer: cascade.displacementBuffer,
      resolution,
    });
    cascade.computeGlobalUpdate = [
      cascade.computeTimeEvolution,
      ...computeGlobalIFFT2D,
      computeNormalize,
      cascade.computeNormals,
    ];
    cascade.computeSharedUpdate = [
      cascade.computeTimeEvolution,
      ...computeSharedIFFT2D,
      computeNormalize,
      cascade.computeNormals,
    ];
  }

  public init() {
    assignCascadeBands(this.cascades.map((c) => c.uniforms));
    for (let i = 0; i < this.cascades.length; i++) {
      this.createComputeShadersForCascade(this.cascades[i]);
    }

    // Three keys compute-group backend state by array identity. Build both A/B
    // command sequences once so toggling does not reconstruct either graph.
    this.computeGlobalUpdateGroup = this.cascades.flatMap(
      (cascade) => cascade.computeGlobalUpdate,
    );
    this.computeGlobalInitializeAndUpdateGroup = this.cascades.flatMap(
      (cascade) => [cascade.computeInitSpectrum, ...cascade.computeGlobalUpdate],
    );
    this.computeSharedUpdateGroup = this.cascades.flatMap(
      (cascade) => cascade.computeSharedUpdate,
    );
    this.computeSharedInitializeAndUpdateGroup = this.cascades.flatMap(
      (cascade) => [cascade.computeInitSpectrum, ...cascade.computeSharedUpdate],
    );
  }

  public async update(deltaTime: number = 0.016): Promise<void> {
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

    await this.dispatchCascadeUpdates(this.renderer, deltaTime);
  }

  /**
   * Encode every cascade's ordered update in one WebGPU compute pass and queue
   * submission. Dispatch boundaries still order all storage-buffer hazards:
   * init → time evolution → horizontal FFT → vertical FFT → normalize →
   * normals.
   */
  private async dispatchCascadeUpdates(
    renderer: THREE.WebGPURenderer,
    deltaTime: number,
  ): Promise<void> {
    const needsInitialization = this.cascades.some(
      (cascade) => !cascade.initialized,
    );

    for (const cascade of this.cascades) {
      cascade.uniforms.time.value = this.time;
      cascade.uniforms.deltaTime.value = deltaTime;
    }

    const useSharedMemoryFFT =
      this.sharedMemoryFFTEnabled && this.sharedMemoryFFTSupported;
    const computeGroup = useSharedMemoryFFT
      ? needsInitialization
        ? this.computeSharedInitializeAndUpdateGroup
        : this.computeSharedUpdateGroup
      : needsInitialization
        ? this.computeGlobalInitializeAndUpdateGroup
        : this.computeGlobalUpdateGroup;
    if (computeGroup.length === 0) return;

    await renderer.computeAsync(computeGroup);
    if (needsInitialization) {
      // Existing invalidation paths mark every cascade dirty together. If a
      // future path invalidates only one, reinitializing the others is still
      // deterministic and keeps this persistent all-cascade group valid.
      for (const cascade of this.cascades) {
        cascade.initialized = true;
      }
    }
  }

  public setMaxScale(maxScale: number) {
    const resolutions = this.cascades.map((c) => c.uniforms.resolution.value);
    for (let i = 0; i < this.cascades.length; i++) {
      const cascade = this.cascades[i];
      const scale = deriveCascadeScale(maxScale, resolutions, i);
      cascade.uniforms.setScale(scale);
      cascade.scale = scale;
      cascade.initialized = false;
    }
    // Tile sizes changed → band edges shift; recompute across all cascades
    // since neighbor seams depend on each other.
    assignCascadeBands(this.cascades.map((c) => c.uniforms));
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

  public getNormalTexture(cascadeIndex: number = 0): THREE.Texture | null {
    return this.cascades[cascadeIndex]?.normalTexture ?? null;
  }

  public getResolution(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.resolution ?? 256;
  }

  public getScale(cascadeIndex: number = 0): number {
    return this.cascades[cascadeIndex]?.scale ?? 100;
  }

  /**
   * Get a cascade's world-space scale uniform node (the single source of truth
   * synced on cascade-config changes). The world-fixed foam field binds to it so
   * its world→texel sampling of the cascade normal texture tracks the live scale.
   */
  public getScaleNode(cascadeIndex: number = 0): Node | null {
    return this.cascades[cascadeIndex]?.uniforms.scale ?? null;
  }

  public getCascadeScales(): number[] {
    return this.cascades.map((c) => c.scale);
  }

  public getCascadeResolutions(): number[] {
    return this.cascades.map((c) => c.resolution);
  }

  public async initializeBuffers(renderer: THREE.WebGPURenderer): Promise<void> {
    this.time += 0.016 * this._animationSpeed;
    await this.dispatchCascadeUpdates(renderer, 0.016);
  }

  public dispose(): void {
    this.computeGlobalUpdateGroup = [];
    this.computeGlobalInitializeAndUpdateGroup = [];
    this.computeSharedUpdateGroup = [];
    this.computeSharedInitializeAndUpdateGroup = [];
    this.cascades = [];
  }

}
