// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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
import { WAVE_INVERSE_SOLVE_ITERATIONS } from "../IWaveSampler";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import type { WebGPUWaveSimulation } from "./WebGPUWaveSimulation";
import {
  sampleDisplacementXYZ,
  sampleNormalTexture,
} from "./shaders/sampleBuffers";
import type { Node, StorageBufferNode } from "../../../shaders/types";
import type { UniformFloatNode } from "../../../types/tsl";

export { MAX_SAMPLE_POINTS } from "../IWaveSampler";

/**
 * WebGPU wave sampler using GPU compute shaders.
 * Samples water height and surface normals at arbitrary world positions.
 *
 * FFT cascade displacement/normals are evaluated on the GPU in the compute
 * shader, including the inverse position solve for horizontal displacement
 * correction.
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

  // Cascade uniforms, one per active cascade. Fixed for this sampler's
  // lifetime — a cascade-count change rebuilds the whole sampler (see
  // `WaterSystem.setQualityLevel`), so the compute shader below unrolls a
  // plain TS loop over these instead of gating cascades at runtime.
  private cascadeUniforms: { resolution: UniformFloatNode; scale: UniformFloatNode }[] = [];

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

    for (let i = 0; i < this.oceanSim.getCascadeCount(); i++) {
      this.cascadeUniforms.push({
        resolution: uniform(256),
        scale: uniform(500.0),
      });
    }

    this.updateCascadeUniforms();
    this.createComputeShader();
  }

  public updateCascadeUniforms(): void {
    const resolutions = this.oceanSim.getCascadeResolutions();
    const scales = this.oceanSim.getCascadeScales();

    for (let i = 0; i < this.cascadeUniforms.length; i++) {
      this.cascadeUniforms[i].resolution.value = resolutions[i];
      this.cascadeUniforms[i].scale.value = scales[i];
    }
  }

  private createComputeShader(): void {
    const cascadeCount = this.cascadeUniforms.length;
    const dispBuffers: (StorageBufferNode | null)[] = [];
    const normalTextures: (THREE.Texture | null)[] = [];
    for (let i = 0; i < cascadeCount; i++) {
      dispBuffers.push(this.oceanSim.getDisplacementBuffer(i));
      normalTextures.push(this.oceanSim.getNormalTexture(i));
    }

    if (!dispBuffers[0] || !normalTextures[0]) {
      console.warn("WebGPUWaveSampler: Wave resources are unavailable");
      return;
    }

    // Capture uniforms for closure
    const sampleCount = this.sampleCountUniform;
    const cascadeUniforms = this.cascadeUniforms;
    const positionBuffer = this.positionBufferNode;
    const outputBuffer = this.outputBufferNode;

    /**
     * Sample combined FFT displacement at a position, hierarchically: each
     * cascade after the first samples at coordinates displaced by the
     * running sum of every coarser cascade's displacement. Returns the
     * total displacement plus the per-cascade sample coordinates, reused
     * below to sample normals at matching positions.
     */
    const sampleCombinedDisplacement = (sampleX: Node, sampleZ: Node) => {
      let x = sampleX;
      let z = sampleZ;
      let totalDisp: Node = vec3(0, 0, 0);
      const sampleCoords: { x: Node; z: Node }[] = [];

      for (let i = 0; i < cascadeCount; i++) {
        sampleCoords.push({ x, z });
        const d = sampleDisplacementXYZ(
          x,
          z,
          dispBuffers[i]!,
          cascadeUniforms[i].resolution,
          cascadeUniforms[i].scale,
        );
        totalDisp =
          i === 0
            ? d
            : vec3(
                totalDisp.x.add(d.x),
                totalDisp.y.add(d.y),
                totalDisp.z.add(d.z),
              );

        if (i < cascadeCount - 1) {
          x = x.add(d.x);
          z = z.add(d.z);
        }
      }

      return { totalDisp, sampleCoords };
    };

    // Create compute shader function (FFT cascades)
    const computeFn = Fn(() => {
      const idx = instanceIndex;
      const isActive = step(float(idx), float(sampleCount).sub(0.5));

      const pos = positionBuffer.element(idx);
      const worldX = pos.x;
      const worldZ = pos.y;

      // Invert the horizontal (choppy) displacement: solve u + D_xz(u) = world
      // by fixed-point iteration u <- world - D_xz(u). One step suffices in calm
      // water; steep crests at high choppiness need several to converge.
      let result = sampleCombinedDisplacement(worldX, worldZ);
      for (let i = 0; i < WAVE_INVERSE_SOLVE_ITERATIONS; i++) {
        const correctedX = worldX.sub(result.totalDisp.x);
        const correctedZ = worldZ.sub(result.totalDisp.z);
        result = sampleCombinedDisplacement(correctedX, correctedZ);
      }

      const totalHeight = result.totalDisp.y;

      // Sample and blend FFT normals (RNM) at the same hierarchical
      // positions used for displacement above.
      let blendedNormal: Node = vec3(0, 1, 0);
      for (let i = 0; i < cascadeCount; i++) {
        const coords = result.sampleCoords[i];
        const n = sampleNormalTexture(
          coords.x,
          coords.z,
          normalTextures[i]!,
          cascadeUniforms[i].resolution,
          cascadeUniforms[i].scale,
        );
        blendedNormal =
          i === 0
            ? n
            : vec3(
                blendedNormal.x.add(n.x),
                blendedNormal.y.add(n.y.sub(1.0)),
                blendedNormal.z.add(n.z),
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
