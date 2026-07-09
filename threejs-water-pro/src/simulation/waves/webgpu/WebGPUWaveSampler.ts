/**
 * WebGPU-based wave sampler using GPU compute shaders.
 */

import * as THREE from "three/webgpu";
import {
  uniform,
  storage,
  Fn,
  instanceIndex,
  float,
  step,
  vec3,
  vec4,
  normalize,
} from "three/tsl";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import type { WebGPUWaveSimulation } from "./WebGPUWaveSimulation";
import { computeGerstner } from "../../../shaders/gerstner";
import { sampleDisplacementXYZ, sampleNormal } from "./shaders/sampleBuffers";

export { MAX_SAMPLE_POINTS } from "../IWaveSampler";

/**
 * WebGPU wave sampler using GPU compute shaders.
 * Samples water height and surface normals at arbitrary world positions.
 *
 * Both FFT cascade displacement/normals and Gerstner wave displacement/normals
 * are evaluated on the GPU in the compute shader, including the inverse
 * position solve for horizontal displacement correction.
 */
export class WebGPUWaveSampler implements IWaveSampler {
  private renderer: THREE.WebGPURenderer;
  private oceanSim: WebGPUWaveSimulation;

  // Input buffer for sample positions (vec4: x, z, unused, unused)
  private positionBuffer: THREE.StorageInstancedBufferAttribute;
  private positionBufferNode: ReturnType<typeof storage>;

  // Output buffer (height, normalX, normalY, normalZ)
  private outputBuffer: THREE.StorageInstancedBufferAttribute;
  private outputBufferNode: ReturnType<typeof storage>;

  // Number of active samples this frame
  private sampleCountUniform = uniform(0);

  // Cascade uniforms
  private cascadeUniforms = {
    count: uniform(1),
    cascade0: { resolution: uniform(256), scale: uniform(500.0) },
    cascade1: { resolution: uniform(256), scale: uniform(2500.0) },
  };

  // Gerstner compile-time max waves (determines shader loop bound)
  private gerstnerMaxWaves: number;

  // Compute shader node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private computeNode: any = null;

  // Cached results for CPU access
  private cachedResults: WaveSample[] = [];
  private currentSampleCount: number = 0;

  // Holds the in-flight readback from the previous `updateLowLatency()`
  // call. Drained at the start of the next call, by which point the GPU
  // has had a full frame to finish, so awaiting it does not stall.
  private pendingReadback: Promise<ArrayBuffer> | null = null;
  private pendingSampleCount = 0;

  private static readonly MAX_POINTS = 128;

  constructor(oceanSim: WebGPUWaveSimulation, renderer: THREE.WebGPURenderer) {
    this.oceanSim = oceanSim;
    this.renderer = renderer;
    this.gerstnerMaxWaves = oceanSim.getGerstnerMaxWaves();

    for (let i = 0; i < WebGPUWaveSampler.MAX_POINTS; i++) {
      this.cachedResults.push({
        height: 0,
        normal: new THREE.Vector3(0, 1, 0),
      });
    }

    this.positionBuffer = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(WebGPUWaveSampler.MAX_POINTS * 4),
      4,
    );
    this.positionBufferNode = storage(
      this.positionBuffer,
      "vec4",
      WebGPUWaveSampler.MAX_POINTS,
    );

    this.outputBuffer = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(WebGPUWaveSampler.MAX_POINTS * 4),
      4,
    );
    this.outputBufferNode = storage(
      this.outputBuffer,
      "vec4",
      WebGPUWaveSampler.MAX_POINTS,
    );

    this.updateCascadeUniforms();
    this.createComputeShader();
  }

  public updateCascadeUniforms(): void {
    const cascadeCount = this.oceanSim.getCascadeCount();
    this.cascadeUniforms.count.value = cascadeCount;

    const resolutions = this.oceanSim.getCascadeResolutions();
    const scales = this.oceanSim.getCascadeScales();

    if (resolutions.length >= 1) {
      this.cascadeUniforms.cascade0.resolution.value = resolutions[0];
      this.cascadeUniforms.cascade0.scale.value = scales[0];
    }
    if (resolutions.length >= 2) {
      this.cascadeUniforms.cascade1.resolution.value = resolutions[1];
      this.cascadeUniforms.cascade1.scale.value = scales[1];
    }
  }

  private createComputeShader(): void {
    // Get buffers from ocean simulation (max 2 cascades)
    const dispBuffer0 = this.oceanSim.getDisplacementBuffer(0);
    const dispBuffer1 = this.oceanSim.getDisplacementBuffer(1) ?? dispBuffer0;

    const normBuffer0 = this.oceanSim.getNormalBuffer(0);
    const normBuffer1 = this.oceanSim.getNormalBuffer(1) ?? normBuffer0;

    if (!dispBuffer0 || !normBuffer0) {
      console.warn("WebGPUWaveSampler: No storage buffers available");
      return;
    }

    // Get Gerstner resources
    const gerstnerWaveBuffer = this.oceanSim.getGerstnerWaveBuffer();
    const gerstnerWaveCount = this.oceanSim.getGerstnerWaveCountUniform();
    const gerstnerTime = this.oceanSim.getTimeUniform();
    const gerstnerMaxWaves = this.gerstnerMaxWaves;

    // Capture uniforms for closure
    const sampleCount = this.sampleCountUniform;
    const {
      count: cascadeCount,
      cascade0,
      cascade1,
    } = this.cascadeUniforms;
    const positionBuffer = this.positionBufferNode;
    const outputBuffer = this.outputBufferNode;

    /**
     * Sample combined FFT + Gerstner displacement at a position.
     * Returns { totalDisp, sampleX0, sampleZ0, sampleX1, sampleZ1 }
     */
    const sampleCombinedDisplacement = (
      sampleX: ReturnType<typeof float>,
      sampleZ: ReturnType<typeof float>,
      hasCascade1: ReturnType<typeof float>,
    ) => {
      // FFT Cascade 0 (waves): sample at original position
      const d0 = sampleDisplacementXYZ(
        sampleX,
        sampleZ,
        dispBuffer0!,
        cascade0.resolution,
        cascade0.scale,
      );

      // FFT Cascade 1 (ripples): sample at position displaced by waves
      const sampleX1 = sampleX.add(d0.x);
      const sampleZ1 = sampleZ.add(d0.z);
      const d1 = sampleDisplacementXYZ(
        sampleX1,
        sampleZ1,
        dispBuffer1!,
        cascade1.resolution,
        cascade1.scale,
      );

      let totalDisp = vec3(
        d0.x.add(d1.x.mul(hasCascade1)),
        d0.y.add(d1.y.mul(hasCascade1)),
        d0.z.add(d1.z.mul(hasCascade1)),
      );

      // Add Gerstner displacement (compiles to no-op when maxWaves === 0)
      if (gerstnerMaxWaves > 0 && gerstnerWaveBuffer && gerstnerWaveCount && gerstnerTime) {
        const gerstner = computeGerstner({
          worldX: sampleX,
          worldZ: sampleZ,
          time: gerstnerTime,
          waveBuffer: gerstnerWaveBuffer,
          waveCount: gerstnerWaveCount,
          maxWaves: gerstnerMaxWaves,
        });
        totalDisp = vec3(
          totalDisp.x.add(gerstner.displacement.x),
          totalDisp.y.add(gerstner.displacement.y),
          totalDisp.z.add(gerstner.displacement.z),
        );
      }

      return { totalDisp, sampleX0: sampleX, sampleZ0: sampleZ, sampleX1, sampleZ1 };
    };

    // Create compute shader function (FFT cascades + Gerstner)
    const computeFn = Fn(() => {
      const idx = instanceIndex;
      const isActive = step(float(idx), float(sampleCount).sub(0.5));

      const pos = positionBuffer.element(idx);
      const worldX = pos.x;
      const worldZ = pos.y;

      const hasCascade1 = step(1.5, float(cascadeCount));

      // Pass 1: estimate combined displacement for inverse solve
      const result1 = sampleCombinedDisplacement(worldX, worldZ, hasCascade1);

      // Correct for horizontal displacement
      const correctedX = worldX.sub(result1.totalDisp.x);
      const correctedZ = worldZ.sub(result1.totalDisp.z);

      // Pass 2: sample at corrected position for accurate height + normal
      const result2 = sampleCombinedDisplacement(correctedX, correctedZ, hasCascade1);

      const totalHeight = result2.totalDisp.y;

      // Sample FFT normals at corrected cascade positions
      const n0 = sampleNormal(
        result2.sampleX0,
        result2.sampleZ0,
        normBuffer0!,
        cascade0.resolution,
        cascade0.scale,
      );
      const n1 = sampleNormal(
        result2.sampleX1,
        result2.sampleZ1,
        normBuffer1!,
        cascade1.resolution,
        cascade1.scale,
      );

      // Blend FFT normals
      let blendedNormal = vec3(
        n0.x.add(n1.x.mul(hasCascade1)),
        n0.y.add(n1.y.sub(1.0).mul(hasCascade1)),
        n0.z.add(n1.z.mul(hasCascade1)),
      );

      // Blend Gerstner normals using RNM (Reoriented Normal Mapping)
      if (gerstnerMaxWaves > 0 && gerstnerWaveBuffer && gerstnerWaveCount && gerstnerTime) {
        const gerstner = computeGerstner({
          worldX: correctedX,
          worldZ: correctedZ,
          time: gerstnerTime,
          waveBuffer: gerstnerWaveBuffer,
          waveCount: gerstnerWaveCount,
          maxWaves: gerstnerMaxWaves,
        });
        blendedNormal = vec3(
          blendedNormal.x.add(gerstner.normal.x),
          blendedNormal.y.add(gerstner.normal.y.sub(1.0)),
          blendedNormal.z.add(gerstner.normal.z),
        );
      }

      const finalNormal = normalize(blendedNormal);

      outputBuffer.element(idx).assign(
        vec4(
          totalHeight.mul(isActive),
          finalNormal.x.mul(isActive),
          finalNormal.y.mul(isActive).add(float(1.0).sub(isActive)),
          finalNormal.z.mul(isActive),
        ),
      );
    });

    this.computeNode = computeFn().compute(WebGPUWaveSampler.MAX_POINTS);
  }

  public setPositions(positions: THREE.Vector2[] | THREE.Vector3[]): void {
    this.currentSampleCount = Math.min(
      positions.length,
      WebGPUWaveSampler.MAX_POINTS,
    );

    const data = this.positionBuffer.array as Float32Array;
    for (let i = 0; i < this.currentSampleCount; i++) {
      const pos = positions[i];
      data[i * 4 + 0] = pos.x;
      data[i * 4 + 1] = pos instanceof THREE.Vector3 ? pos.z : pos.y;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    }

    this.positionBuffer.clearUpdateRanges();
    this.positionBuffer.addUpdateRange(0, this.currentSampleCount * 4);
    this.positionBuffer.needsUpdate = true;
    this.sampleCountUniform.value = this.currentSampleCount;
  }

  /**
   * Synchronous sample: dispatches compute and waits for GPU→CPU readback
   * before resolving. Use for one-off queries (e.g. `WaterSystem.getHeightAt`)
   * where the caller needs the result immediately. Per-frame consumers
   * should prefer {@link updateLowLatency}.
   */
  public async update(): Promise<void> {
    if (this.currentSampleCount === 0) return;
    if (!this.computeNode) return;

    // Drop any pending frame-late readback to avoid the next caller
    // splatting stale data over `cachedResults`.
    this.pendingReadback = null;
    this.pendingSampleCount = 0;

    await this.renderer.computeAsync(this.computeNode);
    const arrayBuffer = await this.renderer.getArrayBufferAsync(
      this.outputBuffer,
    );
    this.applyReadback(arrayBuffer, this.currentSampleCount);
  }

  /**
   * Frame-late sample: at the start of each call, drain the readback
   * dispatched by the *previous* call (typically resolves instantly), then
   * dispatch this frame's compute and kick off a new readback without
   * awaiting it. `getSample()` therefore returns frame N-1's data when
   * called after frame N's `updateLowLatency()`.
   *
   * Use from per-frame consumers like the buoyancy system. The one-frame
   * lag is imperceptible at 60 fps and removes the per-frame GPU sync
   * stall (~2 ms on Apple Silicon WebGPU) that the synchronous path
   * incurs.
   */
  public async updateLowLatency(): Promise<void> {
    if (!this.computeNode) return;

    if (this.pendingReadback) {
      const arrayBuffer = await this.pendingReadback;
      this.pendingReadback = null;
      this.applyReadback(arrayBuffer, this.pendingSampleCount);
    }

    if (this.currentSampleCount === 0) return;

    await this.renderer.computeAsync(this.computeNode);
    this.pendingReadback = this.renderer.getArrayBufferAsync(this.outputBuffer);
    this.pendingSampleCount = this.currentSampleCount;
  }

  private applyReadback(arrayBuffer: ArrayBuffer, count: number): void {
    const data = new Float32Array(arrayBuffer);
    const n = Math.min(count, WebGPUWaveSampler.MAX_POINTS);
    for (let i = 0; i < n; i++) {
      const offset = i * 4;
      const result = this.cachedResults[i];
      result.height = data[offset + 0];
      result.normal.set(data[offset + 1], data[offset + 2], data[offset + 3]);
      result.normal.normalize();
    }
  }

  public getSample(index: number): WaveSample {
    if (index < 0 || index >= WebGPUWaveSampler.MAX_POINTS) {
      return { height: 0, normal: new THREE.Vector3(0, 1, 0) };
    }
    return this.cachedResults[index];
  }

  public getSamples(): WaveSample[] {
    return this.cachedResults.slice(0, this.currentSampleCount);
  }

  public getSampleCount(): number {
    return this.currentSampleCount;
  }

  public dispose(): void {
    this.pendingReadback = null;
    this.pendingSampleCount = 0;
    // Buffer cleanup handled by Three.js
  }
}
