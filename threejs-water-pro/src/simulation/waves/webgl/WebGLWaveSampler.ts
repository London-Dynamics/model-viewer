/**
 * WebGL wave sampler using CPU readback from FFT displacement textures.
 */

import * as THREE from "three/webgpu";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import { MAX_SAMPLE_POINTS } from "../IWaveSampler";
import type { WebGLWaveSimulation } from "./WebGLWaveSimulation";

export { MAX_SAMPLE_POINTS };

interface GerstnerDisplacement {
  dx: number;
  dy: number;
  dz: number;
  nx: number;
  ny: number;
  nz: number;
}

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

  // Displacement texture readback buffers
  private displacementReadBuffer: Float32Array | null = null;
  private normalReadBuffer: Float32Array | null = null;
  private lastReadResolution: number = 0;
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
   * Evaluate Gerstner wave displacement and analytical normal on CPU.
   */
  private evaluateGerstnerCPU(
    worldX: number,
    worldZ: number,
    waveData: THREE.Vector4[],
    waveCount: number,
    time: number,
  ): GerstnerDisplacement {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let totalNx = 0;
    let totalNySub = 0;
    let totalNz = 0;

    for (let i = 0; i < waveCount; i++) {
      const params0 = waveData[i * 2];
      const params1 = waveData[i * 2 + 1];
      const dirX = params0.x;
      const dirZ = params0.y;
      const amplitude = params0.z;
      const wavelength = params0.w;
      const steepness = params1.x;
      const phaseOffset = params1.y;
      const omega = params1.z;

      const k = (2 * Math.PI) / (wavelength + 0.0001);
      const phase = (dirX * worldX + dirZ * worldZ) * k - omega * time + phaseOffset;
      const cosPhase = Math.cos(phase);
      const sinPhase = Math.sin(phase);

      dx += -steepness * amplitude * dirX * sinPhase;
      dy += amplitude * cosPhase;
      dz += -steepness * amplitude * dirZ * sinPhase;

      const kA = k * amplitude;
      totalNx += dirX * kA * sinPhase;
      totalNySub += steepness * kA * cosPhase;
      totalNz += dirZ * kA * sinPhase;
    }

    const rawNx = totalNx;
    const rawNy = 1.0 - totalNySub;
    const rawNz = totalNz;
    const len = Math.sqrt(rawNx * rawNx + rawNy * rawNy + rawNz * rawNz) + 0.0001;

    return {
      dx,
      dy,
      dz,
      nx: rawNx / len,
      ny: rawNy / len,
      nz: rawNz / len,
    };
  }

  /**
   * Sample displacement from the texture at the given world position.
   */
  private sampleDisplacement(
    worldX: number,
    worldZ: number,
    resolution: number,
    scale: number,
  ): THREE.Vector3 {
    if (!this.displacementReadBuffer) {
      return new THREE.Vector3(0, 0, 0);
    }

    // Convert world coords to pixel coords (same formula as shader)
    const baseRes = 256.0;
    const effectiveScale = (scale * resolution) / baseRes;

    const u = worldX / effectiveScale + 0.5;
    const v = worldZ / effectiveScale + 0.5;

    // Wrap to [0, 1]
    const wrappedU = ((u % 1) + 1) % 1;
    const wrappedV = ((v % 1) + 1) % 1;

    // Bilinear interpolation
    const px = wrappedU * resolution;
    const py = wrappedV * resolution;

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = (x0 + 1) % resolution;
    const y1 = (y0 + 1) % resolution;

    const fx = px - x0;
    const fy = py - y0;

    const buf = this.displacementReadBuffer!;
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
   * Sample normal from the texture at the given world position.
   */
  private sampleNormal(
    worldX: number,
    worldZ: number,
    resolution: number,
    scale: number,
  ): THREE.Vector3 {
    if (!this.normalReadBuffer) {
      return new THREE.Vector3(0, 1, 0);
    }

    const baseRes = 256.0;
    const effectiveScale = (scale * resolution) / baseRes;

    const u = worldX / effectiveScale + 0.5;
    const v = worldZ / effectiveScale + 0.5;

    const wrappedU = ((u % 1) + 1) % 1;
    const wrappedV = ((v % 1) + 1) % 1;

    const px = wrappedU * resolution;
    const py = wrappedV * resolution;

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = (x0 + 1) % resolution;
    const y1 = (y0 + 1) % resolution;

    const fx = px - x0;
    const fy = py - y0;

    const buf = this.normalReadBuffer!;
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
    return this._tRow0.lerp(this._tRow1, fy).normalize();
  }

  public updateLowLatency(): Promise<void> {
    return this.update();
  }

  public async update(): Promise<void> {
    if (this._disposed || this.currentSampleCount === 0) return;

    const resolution = this.simulation.getResolution(0);
    const scale = this.simulation.getScale(0);

    // Reallocate buffers if resolution changed
    if (resolution !== this.lastReadResolution) {
      this.displacementReadBuffer = new Float32Array(resolution * resolution * 4);
      this.normalReadBuffer = new Float32Array(resolution * resolution * 4);
      this.lastReadResolution = resolution;
    }

    // Read back texture data from GPU render targets
    const displacementRT = this.simulation.getDisplacementRenderTarget(0);
    const normalRT = this.simulation.getNormalRenderTarget(0);

    if (displacementRT && normalRT) {
      try {
        const [dispData, normalData] = await Promise.all([
          this.renderer.readRenderTargetPixelsAsync(
            displacementRT, 0, 0, resolution, resolution,
          ),
          this.renderer.readRenderTargetPixelsAsync(
            normalRT, 0, 0, resolution, resolution,
          ),
        ]);

        // Disposed during async readback — abandon results
        if (this._disposed) return;

        if (dispData instanceof Float32Array) {
          this.displacementReadBuffer = dispData;
        } else {
          this.displacementReadBuffer!.set(new Float32Array(dispData.buffer));
        }

        if (normalData instanceof Float32Array) {
          this.normalReadBuffer = normalData;
        } else {
          this.normalReadBuffer!.set(new Float32Array(normalData.buffer));
        }
      } catch {
        // Readback failed — fall back to Gerstner-only sampling
      }
    }

    if (this._disposed) return;

    // Get Gerstner wave state
    const gerstner = this.simulation.getGerstnerCPUState();
    const hasGerstner = gerstner.waveCount > 0 && gerstner.waveData !== null;

    for (let i = 0; i < this.currentSampleCount; i++) {
      const pos = this.positions[i];
      let x = pos.x;
      let z = pos.y;

      let finalHeight = 0;
      let fnx = 0;
      let fny = 1;
      let fnz = 0;

      // Sample FFT displacement if available
      if (this.displacementReadBuffer) {
        const disp = this.sampleDisplacement(x, z, resolution, scale);
        finalHeight = disp.y;

        // Apply horizontal displacement correction
        x -= disp.x;
        z -= disp.z;
      }

      // Sample normal from texture
      if (this.normalReadBuffer) {
        const normal = this.sampleNormal(x, z, resolution, scale);
        fnx = normal.x;
        fny = normal.y;
        fnz = normal.z;
      }

      // Add Gerstner displacement and blend normals
      if (hasGerstner) {
        const g = this.evaluateGerstnerCPU(
          x,
          z,
          gerstner.waveData!,
          gerstner.waveCount,
          gerstner.time,
        );
        finalHeight += g.dy;

        // Blend normals using RNM
        fnx = fnx + g.nx;
        fny = fny + (g.ny - 1.0);
        fnz = fnz + g.nz;
        const len = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) + 0.0001;
        fnx /= len;
        fny /= len;
        fnz /= len;
      }

      // Store results
      this.cachedResults[i].height = finalHeight;
      this.cachedResults[i].normal.set(fnx, fny, fnz);
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
    this.displacementReadBuffer = null;
    this.normalReadBuffer = null;
  }
}
