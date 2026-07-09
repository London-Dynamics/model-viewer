import * as THREE from "three/webgpu";
import { instancedArray } from "three/tsl";
import type { TSLBuffer, TSLComputeShader } from "../../../../types/tsl";
import type {
  IWakeSimulation,
  InjectAlongPathParams,
  WakeSimulationParams,
} from "../IWakeSimulation";
import type { IWakeFieldSampler } from "../IWakeFieldSampler";
import { WakeIWaveCompute } from "./WakeIWaveCompute";
import type { WakeBuffers, WakeDisplacementOutput } from "./WakeIWaveCompute";
import { WebGPUWakeFieldSampler } from "./WebGPUWakeFieldSampler";

/** Kernel half-size — P=10 gives `∝κ` dispersion across the wake band (see wiki/wake/iwave.md). */
const KERNEL_HALF = 10;
/** Source gain: scales the baked per-frame source so a hull pass forms a ~`depth` trough. */
const SOURCE_GAIN = 0.5;
/** Hull speed (m/s) at which the turbulent-track foam reaches full intensity. */
const FOAM_SPEED_REF = 6.0;
/** dt-clamp Courant-like factor for the explicit leapfrog: `dt ≤ FACTOR·√(Δ/g)`. */
const DT_STABILITY = 0.3;

/**
 * WebGPU dispersive wake simulator (Tessendorf's iWave; `wiki/wake/iwave.md`).
 *
 * A height grid advanced by a `√(−∇²)` convolution + explicit leapfrog, giving
 * deep-water dispersion. The convolution is a rank-2 separable approximation of
 * the kernel run as two 1D passes per step (a horizontal pass into a vec2
 * scratch buffer, then a vertical pass folded into the leapfrog; see
 * {@link WakeIWaveCompute}).
 *
 * The leapfrog needs `h_t` and `h_{t−1}`; on a camera-shifting grid a cell reads
 * neighbours at shifted coordinates, so the destination must not alias a buffer
 * being read — hence **three** rotating height buffers (prev/cur/next all
 * distinct) plus three foam buffers in lockstep. One horizontal + one leapfrog
 * variant per rotation phase is dispatched in a 3-cycle; the scratch buffer is
 * transient (rewritten each step) and shared across phases.
 */
export class WebGPUWakeSimulation implements IWakeSimulation {
  private readonly _params: WakeSimulationParams;
  private readonly _renderer: THREE.WebGPURenderer;

  /** Rotating height levels (prev/cur/next) and foam (decay+inject) buffers. */
  private _height: [TSLBuffer, TSLBuffer, TSLBuffer];
  private _foam: [TSLBuffer, TSLBuffer, TSLBuffer];
  /** Transient rank-2 horizontal-convolution scratch (vec2); rewritten each step. */
  private _scratch: TSLBuffer;
  /** Stable displacement output: vec2(height, foam). */
  private _displacement: TSLBuffer;

  private _compute: WakeIWaveCompute;
  /** Horizontal-convolution pass per rotation phase (reads height level `phase`). */
  private _horizontal: [TSLComputeShader, TSLComputeShader, TSLComputeShader];
  /** Vertical-convolution + leapfrog pass per phase: (cur, prev, dst) = (0,2,1), (1,0,2), (2,1,0). */
  private _leapfrog: [TSLComputeShader, TSLComputeShader, TSLComputeShader];
  private _sampler: WebGPUWakeFieldSampler;

  /** Rotation phase in [0,3); selects the variant and buffer roles. */
  private _phase = 0;

  // Camera-origin tracking for the shift.
  private _prevOriginX = 0;
  private _prevOriginZ = 0;
  /** Previous frame's integer texel shift; the prev leapfrog level needs `shift + this`. */
  private _lastShiftX = 0;
  private _lastShiftZ = 0;
  private _firstFrame = true;
  /** When set, the next step zeroes the field (stored content is invalid). */
  private _pendingReset = true;

  /** Generators written this frame; consumed and reset by {@link step}. */
  private _genWriteIndex = 0;

  constructor(params: WakeSimulationParams, renderer: THREE.WebGPURenderer) {
    this._params = { ...params };
    this._renderer = renderer;

    const { resolution, worldSize, gravity, gamma, maxGenerators } = params;
    const count = resolution * resolution;

    this._height = [
      instancedArray(count, "float"),
      instancedArray(count, "float"),
      instancedArray(count, "float"),
    ];
    this._foam = [
      instancedArray(count, "float"),
      instancedArray(count, "float"),
      instancedArray(count, "float"),
    ];
    this._scratch = instancedArray(count, "vec2");
    this._displacement = instancedArray(count, "vec2");

    this._compute = new WakeIWaveCompute(
      resolution, worldSize, gravity, gamma, maxGenerators, KERNEL_HALF,
    );

    const out: WakeDisplacementOutput = { displacement: this._displacement };
    const side = (k: number): WakeBuffers => ({
      height: this._height[k],
      foam: this._foam[k],
    });
    // Phase p: cur=p, prev=(p+2)%3, dst=(p+1)%3. The horizontal pass reads the
    // cur level into scratch; the leapfrog pass consumes scratch + cur + prev.
    this._horizontal = [
      this._compute.buildHorizontalPass(this._height[0], this._scratch),
      this._compute.buildHorizontalPass(this._height[1], this._scratch),
      this._compute.buildHorizontalPass(this._height[2], this._scratch),
    ];
    this._leapfrog = [
      this._compute.buildLeapfrogPass(side(0), side(1), this._height[2], this._scratch, out),
      this._compute.buildLeapfrogPass(side(1), side(2), this._height[0], this._scratch, out),
      this._compute.buildLeapfrogPass(side(2), side(0), this._height[1], this._scratch, out),
    ];

    this._sampler = new WebGPUWakeFieldSampler(
      this._displacement,
      resolution,
      this._compute.worldSizeNode,
      this._compute.originXNode,
      this._compute.originZNode,
    );
  }

  // ============= Public API =============

  getSampler(): IWakeFieldSampler {
    return this._sampler;
  }

  setFriction(value: number): void {
    this._compute.gamma = value;
  }
  setFoamPersistence(value: number): void {
    this._compute.foamPersistence = value;
  }
  setFoamStrength(value: number): void {
    this._compute.foamStrength = value;
  }
  setFoamBreakThreshold(value: number): void {
    this._compute.foamBreakThreshold = value;
  }

  setWorldSize(value: number): void {
    this._compute.worldSize = value;
    // Δ changes — the stored field is at the wrong world scale; clear it.
    this._pendingReset = true;
  }

  injectAlongPath(params: InjectAlongPathParams): void {
    if (this._genWriteIndex >= this._params.maxGenerators) return;
    // Bake the per-frame source stamp. sourceStrength = −depth·speed·gain/radius:
    // over the footprint-crossing dwell the added displacement totals ~depth,
    // independent of speed and radius. speedNorm sets turbulent-track foam.
    const radius = Math.max(params.radius, 1e-3);
    const sourceStrength = (-params.depth * params.speed * SOURCE_GAIN) / radius;
    const speedNorm = Math.min(params.speed / FOAM_SPEED_REF, 1.0);
    this._compute.writeGenerator(
      this._genWriteIndex,
      params.from.x, params.from.z,
      params.to.x, params.to.z,
      sourceStrength, radius, speedNorm,
    );
    this._genWriteIndex++;
  }

  reset(): void {
    this._clearField();
    // Re-anchor (and discard any pending injection) on the next step so the
    // field comes back cleanly if the wake is re-enabled.
    this._pendingReset = true;
    this._genWriteIndex = 0;
  }

  async step(dt: number, originX: number, originZ: number): Promise<void> {
    const { resolution } = this._params;
    const dx = this._compute.worldSizeValue / resolution;

    // Explicit-leapfrog stability clamp (and frame-hitch guard).
    const gravity = 9.81; // matches the shared uniform's default magnitude
    const dtMax = DT_STABILITY * Math.sqrt(dx / gravity);
    this._compute.dt = Math.min(dt, dtMax);

    // Texel-integer camera shift since the buffer's current anchoring.
    const shiftX = this._firstFrame ? 0 : Math.round((originX - this._prevOriginX) / dx);
    const shiftZ = this._firstFrame ? 0 : Math.round((originZ - this._prevOriginZ) / dx);

    const bigJump =
      Math.abs(shiftX) > resolution * 0.25 || Math.abs(shiftZ) > resolution * 0.25;
    if (this._pendingReset || bigJump) {
      this._clearField();
      this._compute.originX = originX;
      this._compute.originZ = originZ;
      this._prevOriginX = originX;
      this._prevOriginZ = originZ;
      this._lastShiftX = 0;
      this._lastShiftZ = 0;
      this._firstFrame = false;
      this._pendingReset = false;
      this._genWriteIndex = 0; // discard this frame's injection onto a cleared field
      return;
    }

    this._firstFrame = false;
    this._compute.originShiftX = shiftX;
    this._compute.originShiftZ = shiftZ;
    // The previous leapfrog level was written two frames ago — align it by the
    // accumulated shift, else it drifts out of step with `cur` as the camera moves.
    this._compute.prevShiftX = shiftX + this._lastShiftX;
    this._compute.prevShiftZ = shiftZ + this._lastShiftZ;
    this._compute.originX = originX;
    this._compute.originZ = originZ;
    this._compute.genCount = this._genWriteIndex;

    // Horizontal convolution into scratch, then the vertical + leapfrog pass
    // (ordered; the backend barriers between them on the shared scratch buffer).
    await this._renderer.computeAsync([
      this._horizontal[this._phase],
      this._leapfrog[this._phase],
    ]);
    this._phase = (this._phase + 1) % 3;

    this._lastShiftX = shiftX;
    this._lastShiftZ = shiftZ;
    this._prevOriginX = originX;
    this._prevOriginZ = originZ;
    this._genWriteIndex = 0;
  }

  /** Zero every field buffer (3 height + 3 foam + displacement) and reset the phase. */
  private _clearField(): void {
    const buffers = [...this._height, ...this._foam, this._displacement];
    for (const buf of buffers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attr = (buf as any).value;
      attr.array.fill(0);
      attr.needsUpdate = true;
    }
    this._phase = 0;
  }

  dispose(): void {
    // TSL instancedArray buffers are garbage-collected; no explicit disposal.
  }
}
