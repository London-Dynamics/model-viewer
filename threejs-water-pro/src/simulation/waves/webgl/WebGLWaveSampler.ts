// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * WebGL wave sampler using CPU readback from FFT displacement textures.
 */

import * as THREE from "three/webgpu";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import { MAX_SAMPLE_POINTS, WAVE_INVERSE_SOLVE_ITERATIONS } from "../IWaveSampler";
import type { WebGLWaveSimulation } from "./WebGLWaveSimulation";

export { MAX_SAMPLE_POINTS };

/** GPU->CPU readback of one cascade's displacement and normal textures. */
interface CascadeReadState {
  resolution: number;
  scale: number;
  displacement: Float32Array;
  normal: Float32Array;
}

/** Resolved element type of `readRenderTargetPixelsAsync` (a typed array). */
type ReadbackArray = Awaited<
  ReturnType<THREE.WebGPURenderer["readRenderTargetPixelsAsync"]>
>;

/**
 * WebGL wave sampler using CPU readback from displacement textures.
 * For WebGL FFT simulation, we read displacement values from the render targets.
 */
export class WebGLWaveSampler implements IWaveSampler {
  private simulation: WebGLWaveSimulation;
  private renderer: THREE.WebGPURenderer;

  // Cached positions
  private positions: THREE.Vector2[] = [];
  private currentSampleCount: number = 0;

  // Cached results
  private cachedResults: WaveSample[] = [];

  // Per-cascade GPU->CPU readback of displacement + normal textures, indexed
  // to match the simulation's cascades (coarsest first).
  private cascadeReads: CascadeReadState[] = [];
  private _disposed = false;

  // Pre-allocated temps for bilinear interpolation (avoids per-frame GC pressure)
  private readonly _t00 = new THREE.Vector3();
  private readonly _t10 = new THREE.Vector3();
  private readonly _t01 = new THREE.Vector3();
  private readonly _t11 = new THREE.Vector3();
  private readonly _tRow0 = new THREE.Vector3();
  private readonly _tRow1 = new THREE.Vector3();

  constructor(simulation: WebGLWaveSimulation, renderer: THREE.WebGPURenderer) {
    this.simulation = simulation;
    this.renderer = renderer;

    // Pre-allocate result cache
    for (let i = 0; i < MAX_SAMPLE_POINTS; i++) {
      this.cachedResults.push({
        height: 0,
        normal: new THREE.Vector3(0, 1, 0),
      });
    }
  }

  public setPositions(positions: THREE.Vector2[] | THREE.Vector3[]): void {
    this.currentSampleCount = Math.min(positions.length, MAX_SAMPLE_POINTS);
    this.positions = [];

    for (let i = 0; i < this.currentSampleCount; i++) {
      const pos = positions[i];
      if (pos instanceof THREE.Vector3) {
        this.positions.push(new THREE.Vector2(pos.x, pos.z));
      } else {
        this.positions.push(pos.clone());
      }
    }
  }

  /**
   * Compute bilinear texel indices and weights for a world position, matching
   * the hardware linear-filtered texture sampling the surface uses.
   *
   * Texel `i` is centered at `(i + 0.5)`, so the lookup is shifted half a texel
   * before flooring. Without that shift the CPU samples half a texel — `scale /
   * (2 * resolution)` world units — off from the rendered surface, which reads as
   * a height offset that grows with wave steepness.
   */
  private texelLerp(
    worldX: number,
    worldZ: number,
    resolution: number,
    scale: number,
  ): { x0: number; y0: number; x1: number; y1: number; fx: number; fy: number } {
    // Tile size is the cascade's world-space scale (matches spectrum.ts).
    // World coords to wrapped [0, 1) UV (same mapping as the shader).
    const u = (((worldX / scale + 0.5) % 1) + 1) % 1;
    const v = (((worldZ / scale + 0.5) % 1) + 1) % 1;

    // The WebGL backend flips render-target textures vertically when the surface
    // samples them (TextureNode applies flipY for isRenderTargetTexture: v -> 1 - v),
    // while the GPU->CPU readback returns raw bottom-up rows. Flip V here so the
    // CPU reads the same texels the surface renders from.
    const vFlipped = 1 - v;

    // Half-texel shift onto texel centers, then bilinear with wraparound.
    const px = u * resolution - 0.5;
    const py = vFlipped * resolution - 0.5;

    const px0 = Math.floor(px);
    const py0 = Math.floor(py);
    const fx = px - px0;
    const fy = py - py0;

    const x0 = ((px0 % resolution) + resolution) % resolution;
    const y0 = ((py0 % resolution) + resolution) % resolution;
    const x1 = (x0 + 1) % resolution;
    const y1 = (y0 + 1) % resolution;

    return { x0, y0, x1, y1, fx, fy };
  }

  /**
   * Sample a cascade's displacement at a world position. Returns a reused temp
   * vector — read its components before the next sample call.
   */
  private sampleCascadeDisplacement(
    cascade: CascadeReadState,
    worldX: number,
    worldZ: number,
  ): THREE.Vector3 {
    const { resolution, scale, displacement: buf } = cascade;
    const { x0, y0, x1, y1, fx, fy } = this.texelLerp(
      worldX,
      worldZ,
      resolution,
      scale,
    );

    const setDisp = (out: THREE.Vector3, x: number, y: number): void => {
      const idx = (y * resolution + x) * 4;
      out.set(buf[idx], buf[idx + 1], buf[idx + 2]);
    };

    setDisp(this._t00, x0, y0);
    setDisp(this._t10, x1, y0);
    setDisp(this._t01, x0, y1);
    setDisp(this._t11, x1, y1);

    // Bilinear blend using pre-allocated temps
    this._tRow0.copy(this._t00).lerp(this._t10, fx);
    this._tRow1.copy(this._t01).lerp(this._t11, fx);
    return this._tRow0.lerp(this._tRow1, fy);
  }

  /**
   * Sample a cascade's surface normal at a world position. Decodes `[0,1]` to
   * `[-1,1]` but does not normalize — cascades are RNM-blended then normalized
   * once by the caller, matching the surface shader. Returns a reused temp.
   */
  private sampleCascadeNormal(
    cascade: CascadeReadState,
    worldX: number,
    worldZ: number,
  ): THREE.Vector3 {
    const { resolution, scale, normal: buf } = cascade;
    const { x0, y0, x1, y1, fx, fy } = this.texelLerp(
      worldX,
      worldZ,
      resolution,
      scale,
    );

    const setNormal = (out: THREE.Vector3, x: number, y: number): void => {
      const idx = (y * resolution + x) * 4;
      // Convert from [0,1] to [-1,1]
      out.set(buf[idx] * 2 - 1, buf[idx + 1] * 2 - 1, buf[idx + 2] * 2 - 1);
    };

    setNormal(this._t00, x0, y0);
    setNormal(this._t10, x1, y0);
    setNormal(this._t01, x0, y1);
    setNormal(this._t11, x1, y1);

    // Bilinear blend using pre-allocated temps
    this._tRow0.copy(this._t00).lerp(this._t10, fx);
    this._tRow1.copy(this._t01).lerp(this._t11, fx);
    return this._tRow0.lerp(this._tRow1, fy);
  }

  /**
   * Read back each cascade's displacement and normal textures into CPU buffers,
   * (re)allocating per-cascade buffers when a cascade's resolution changes.
   */
  private async readCascades(cascadeCount: number): Promise<void> {
    // Phase 1: ensure per-cascade state and issue every readback up front.
    // Issuing before awaiting lets the GPU service them concurrently, so the
    // await below is a single CPU<-GPU sync for all cascades rather than one
    // round-trip per cascade. `targets[t]` owns `reads[2t]` (displacement) and
    // `reads[2t + 1]` (normal).
    const targets: CascadeReadState[] = [];
    const reads: Promise<ReadbackArray>[] = [];

    for (let c = 0; c < cascadeCount; c++) {
      const resolution = this.simulation.getResolution(c);
      const scale = this.simulation.getScale(c);

      let state = this.cascadeReads[c];
      if (!state || state.resolution !== resolution) {
        state = {
          resolution,
          scale,
          displacement: new Float32Array(resolution * resolution * 4),
          normal: new Float32Array(resolution * resolution * 4),
        };
        this.cascadeReads[c] = state;
      } else {
        state.scale = scale;
      }

      const displacementRT = this.simulation.getDisplacementRenderTarget(c);
      const normalRT = this.simulation.getNormalRenderTarget(c);
      if (!displacementRT || !normalRT) continue;

      targets.push(state);
      reads.push(
        this.renderer.readRenderTargetPixelsAsync(
          displacementRT, 0, 0, resolution, resolution,
        ),
        this.renderer.readRenderTargetPixelsAsync(
          normalRT, 0, 0, resolution, resolution,
        ),
      );
    }

    // Drop cascades that no longer exist (e.g. quality level lowered).
    if (this.cascadeReads.length > cascadeCount) {
      this.cascadeReads.length = cascadeCount;
    }

    if (reads.length === 0) return;

    // Phase 2: one sync point for every cascade. `allSettled` so a single failed
    // readback keeps that buffer's previous frame instead of dropping all.
    const settled = await Promise.allSettled(reads);
    if (this._disposed) return;

    for (let t = 0; t < targets.length; t++) {
      const state = targets[t];
      const dispResult = settled[t * 2];
      const normalResult = settled[t * 2 + 1];
      if (dispResult.status === "fulfilled") {
        state.displacement = this.storeReadback(dispResult.value, state.displacement);
      }
      if (normalResult.status === "fulfilled") {
        state.normal = this.storeReadback(normalResult.value, state.normal);
      }
    }
  }

  /**
   * Store a readback result into a cascade buffer. The renderer normally hands
   * back a `Float32Array` we can keep directly; otherwise copy into the existing
   * buffer.
   */
  private storeReadback(data: ReadbackArray, fallback: Float32Array): Float32Array {
    if (data instanceof Float32Array) return data;
    fallback.set(new Float32Array(data.buffer));
    return fallback;
  }

  public updateLowLatency(): Promise<void> {
    return this.update();
  }

  public async update(): Promise<void> {
    if (this._disposed || this.currentSampleCount === 0) return;

    const cascadeCount = this.simulation.getCapabilities().cascadeCount;
    await this.readCascades(cascadeCount);
    if (this._disposed) return;

    const cascades = this.cascadeReads;

    for (let i = 0; i < this.currentSampleCount; i++) {
      const pos = this.positions[i];
      const baseX = pos.x;
      const baseZ = pos.y;

      // Invert the horizontal displacement the surface applies — every FFT
      // cascade (summed at the same position, as the WebGL surface does) —
      // so height and normal are read at the surface parameter that renders
      // at the query position: solve u + D_xz(u) = base by fixed-point
      // iteration u <- base - D_xz(u). The correction must use the *same*
      // terms the vertex shader displaces by; omitting any leaves the sample
      // shifted, a visible offset at high choppiness where displacement
      // reaches meters.
      let x = baseX;
      let z = baseZ;
      for (let k = 0; k < WAVE_INVERSE_SOLVE_ITERATIONS; k++) {
        let dispX = 0;
        let dispZ = 0;
        for (let c = 0; c < cascades.length; c++) {
          const disp = this.sampleCascadeDisplacement(cascades[c], x, z);
          dispX += disp.x;
          dispZ += disp.z;
        }
        x = baseX - dispX;
        z = baseZ - dispZ;
      }

      // Height: sum all FFT cascades at the converged parameter.
      let finalHeight = 0;
      for (let c = 0; c < cascades.length; c++) {
        finalHeight += this.sampleCascadeDisplacement(cascades[c], x, z).y;
      }

      // Normal: RNM-blend the FFT cascades (cascade 0 is the base), then
      // normalize once — matching the surface shader.
      let fnx = 0;
      let fny = 1;
      let fnz = 0;
      for (let c = 0; c < cascades.length; c++) {
        const n = this.sampleCascadeNormal(cascades[c], x, z);
        if (c === 0) {
          fnx = n.x;
          fny = n.y;
          fnz = n.z;
        } else {
          fnx += n.x;
          fny += n.y - 1.0;
          fnz += n.z;
        }
      }

      const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) + 0.0001;

      // Store results
      this.cachedResults[i].height = finalHeight;
      this.cachedResults[i].normal.set(fnx / len, fny / len, fnz / len);
    }
  }

  public getSample(index: number): WaveSample {
    if (index < 0 || index >= MAX_SAMPLE_POINTS) {
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

  public updateCascadeUniforms(): void {
    // No cascade uniforms to update for texture-based sampling
  }

  public dispose(): void {
    this._disposed = true;
    this.currentSampleCount = 0;
    this.positions = [];
    this.cachedResults = [];
    this.cascadeReads = [];
  }
}
