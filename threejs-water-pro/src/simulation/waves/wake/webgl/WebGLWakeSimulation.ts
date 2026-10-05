// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { Fn, texture, vec4 } from "three/tsl";
import type { TextureNode } from "three/webgpu";
import type {
  IWakeSimulation,
  InjectAlongPathParams,
  WakeSimulationParams,
} from "../IWakeSimulation";
import type { IWakeFieldSampler } from "../IWakeFieldSampler";
import type { TSLUniformNode } from "../../../../types/tsl";
import { DT_STABILITY, FOAM_SPEED_REF, SOURCE_GAIN } from "../constants";
import { WakeIWaveMaterials } from "./WakeIWaveMaterials";
import type {
  WakeHorizontalMaterialResult,
  WakeLeapfrogMaterialResult,
} from "./WakeIWaveMaterials";
import { WebGLWakeFieldSampler } from "./WebGLWakeFieldSampler";

/**
 * WebGL dispersive wake simulator (Tessendorf's iWave).
 *
 * The render-to-texture sibling of {@link WebGPUWakeSimulation}: the same height
 * grid advanced by a `√(−∇²)` convolution + explicit leapfrog, but state lives in
 * float render targets and the update runs as two fragment passes (a horizontal
 * convolution into a scratch target, then a vertical convolution folded into the
 * leapfrog) drawn over a full-screen quad.
 *
 * The leapfrog needs `h_t` and `h_{t−1}`; on a camera-shifting grid a cell reads
 * neighbours at shifted coordinates, so the destination must not alias a target
 * being read — hence **three** rotating state targets (prev/cur/next all
 * distinct). Each texel packs `(height, foam)` into the RG channels; the scratch
 * target packs the rank-2 partial sums into RG. A single horizontal and a single
 * leapfrog material serve all phases — the texture nodes are re-pointed at the
 * current/previous/scratch targets each step.
 */
export class WebGLWakeSimulation implements IWakeSimulation {
  private readonly _params: WakeSimulationParams;
  private readonly _renderer: THREE.WebGPURenderer;

  /** Rotating state targets (prev/cur/next), each RG = (height, foam). */
  private _state: [THREE.RenderTarget, THREE.RenderTarget, THREE.RenderTarget];
  /** Transient rank-2 horizontal-convolution scratch (RG); rewritten each step. */
  private _scratch: THREE.RenderTarget;

  private _materials: WakeIWaveMaterials;
  private _horizontal: WakeHorizontalMaterialResult;
  private _leapfrog: WakeLeapfrogMaterialResult;
  private _clearMaterial: THREE.MeshBasicNodeMaterial;
  private readonly _quad: THREE.QuadMesh;

  /** Sampler-bound displacement node; re-pointed at the freshly written target each step. */
  private _displacementTextureNode: TextureNode;
  private _sampler: WebGLWakeFieldSampler;

  /** Rotation phase in [0,3); selects the current/previous/destination targets. */
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
  /** Sleeps the solver while every persistent field target is known to be zero. */
  private _solverSleeping = true;

  /** Generators written this frame; consumed and reset by {@link step}. */
  private _genWriteIndex = 0;

  constructor(params: WakeSimulationParams, renderer: THREE.WebGPURenderer) {
    this._params = { ...params };
    this._renderer = renderer;

    const { resolution, worldSize, gravity, gamma, maxGenerators } = params;

    this._state = [
      this._createStateTarget(resolution),
      this._createStateTarget(resolution),
      this._createStateTarget(resolution),
    ];
    this._scratch = this._createStateTarget(resolution);

    this._materials = new WakeIWaveMaterials(
      resolution, worldSize, gravity, gamma, maxGenerators,
    );
    this._horizontal = this._materials.buildHorizontalMaterial();
    this._leapfrog = this._materials.buildLeapfrogMaterial();
    this._clearMaterial = this._buildClearMaterial();
    this._quad = new THREE.QuadMesh();

    // The sampler binds the most-recently-written state target; start it on a
    // cleared one so the surface reads zero wake until the first real step.
    this._displacementTextureNode = texture(this._state[0].texture);
    this._sampler = new WebGLWakeFieldSampler(
      this._displacementTextureNode,
      resolution,
      this._materials.worldSizeNode,
      this._materials.originXNode,
      this._materials.originZNode,
    );

    // Render targets start with undefined contents; zero them so the first
    // samples (before the first real step) read zero wake rather than garbage.
    this._clearFieldAndSleep();
  }

  // ============= Public API =============

  getSampler(): IWakeFieldSampler {
    return this._sampler;
  }

  setFriction(value: number): void {
    this._materials.gamma = value;
  }
  setFoamPersistence(value: number): void {
    this._materials.foamPersistence = value;
  }
  setFoamStrength(value: number): void {
    this._materials.foamStrength = value;
  }
  setFoamBreakThreshold(value: number): void {
    this._materials.foamBreakThreshold = value;
  }

  setWorldSize(value: number): void {
    this._materials.worldSize = value;
    // Δ changes — the stored field is at the wrong world scale; clear it.
    this._pendingReset = true;
  }

  injectAlongPath(params: InjectAlongPathParams): void {
    if (this._genWriteIndex >= this._params.maxGenerators) return;
    // Any accepted source wakes the solver until the next explicit clear;
    // detecting decay back to zero would require a GPU readback.
    this._solverSleeping = false;
    // Bake the per-frame source stamp. sourceStrength = −depth·speed·gain/radius:
    // over the footprint-crossing dwell the added displacement totals ~depth,
    // independent of speed and radius. speedNorm sets turbulent-track foam.
    const radius = Math.max(params.radius, 1e-3);
    const sourceStrength = (-params.depth * params.speed * SOURCE_GAIN) / radius;
    const speedNorm = Math.min(params.speed / FOAM_SPEED_REF, 1.0);
    this._materials.writeGenerator(
      this._genWriteIndex,
      params.from.x, params.from.z,
      params.to.x, params.to.z,
      sourceStrength, radius, speedNorm,
    );
    this._genWriteIndex++;
  }

  reset(): void {
    this._clearFieldAndSleep();
    // Re-anchor (and discard any pending injection) on the next step so the
    // field comes back cleanly if the wake is re-enabled.
    this._pendingReset = true;
    this._genWriteIndex = 0;
  }

  async step(dt: number, originX: number, originZ: number): Promise<void> {
    const { resolution } = this._params;
    const dx = this._materials.worldSizeValue / resolution;

    // Explicit-leapfrog stability clamp (and frame-hitch guard). Read the live
    // gravity from the shared uniform — it drives the leapfrog's `cCoeff`, so
    // the clamp must track it rather than assume the default. Floored away from
    // zero so a degenerate gravity can't produce a NaN dt.
    const gravity = Math.max((this._params.gravity as TSLUniformNode).value, 1e-4);
    const dtMax = DT_STABILITY * Math.sqrt(dx / gravity);
    this._materials.dt = Math.min(dt, dtMax);

    // Texel-integer camera shift since the buffer's current anchoring.
    const shiftX = this._firstFrame ? 0 : Math.round((originX - this._prevOriginX) / dx);
    const shiftZ = this._firstFrame ? 0 : Math.round((originZ - this._prevOriginZ) / dx);

    if (this._pendingReset) {
      this._clearFieldAndSleep();
      this._anchorSleepingField(originX, originZ);
      this._pendingReset = false;
      return;
    }

    // While sleeping, follow the camera by updating only the field mapping and
    // skip both full-grid render passes.
    if (this._solverSleeping && this._genWriteIndex === 0) {
      this._anchorSleepingField(originX, originZ);
      return;
    }

    const bigJump =
      Math.abs(shiftX) > resolution * 0.25 || Math.abs(shiftZ) > resolution * 0.25;
    if (bigJump) {
      this._clearFieldAndSleep();
      this._anchorSleepingField(originX, originZ);
      return;
    }

    this._firstFrame = false;
    this._materials.originShiftX = shiftX;
    this._materials.originShiftZ = shiftZ;
    // The previous leapfrog level was written two frames ago — align it by the
    // accumulated shift, else it drifts out of step with `cur` as the camera moves.
    this._materials.prevShiftX = shiftX + this._lastShiftX;
    this._materials.prevShiftZ = shiftZ + this._lastShiftZ;
    this._materials.originX = originX;
    this._materials.originZ = originZ;
    this._materials.genCount = this._genWriteIndex;

    // Phase p: cur=p, prev=(p+2)%3, dst=(p+1)%3. The horizontal pass reads the
    // cur level into scratch; the leapfrog pass consumes scratch + cur + prev.
    const cur = this._state[this._phase];
    const prev = this._state[(this._phase + 2) % 3];
    const dst = this._state[(this._phase + 1) % 3];

    this._horizontal.srcStateTextureNode.value = cur.texture;
    this._renderToTarget(this._horizontal.material, this._scratch);

    this._leapfrog.scratchTextureNode.value = this._scratch.texture;
    this._leapfrog.curStateTextureNode.value = cur.texture;
    this._leapfrog.prevStateTextureNode.value = prev.texture;
    this._renderToTarget(this._leapfrog.material, dst);

    // The sampler reads the level just written.
    this._displacementTextureNode.value = dst.texture;
    this._phase = (this._phase + 1) % 3;

    this._lastShiftX = shiftX;
    this._lastShiftZ = shiftZ;
    this._prevOriginX = originX;
    this._prevOriginZ = originZ;
    this._genWriteIndex = 0;
  }

  dispose(): void {
    for (const target of this._state) target.dispose();
    this._scratch.dispose();
    this._horizontal.material.dispose();
    this._leapfrog.material.dispose();
    this._clearMaterial.dispose();
    this._materials.dispose();
  }

  // ============= Internal =============

  /**
   * Float RG state target. `NearestFilter` so the convolution and the sampler
   * read exact texels; clamp-to-edge so out-of-range reads hold the border (the
   * sponge keeps it near zero).
   */
  private _createStateTarget(resolution: number): THREE.RenderTarget {
    return new THREE.RenderTarget(resolution, resolution, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
    });
  }

  /** Material that writes zero before the solver enters sleep. */
  private _buildClearMaterial(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial();
    material.outputNode = Fn(() => vec4(0.0, 0.0, 0.0, 1.0))();
    material.depthTest = false;
    material.depthWrite = false;
    return material;
  }

  private _renderToTarget(
    material: THREE.Material,
    target: THREE.RenderTarget,
  ): void {
    this._quad.material = material;
    const previous = this._renderer.getRenderTarget();
    this._renderer.setRenderTarget(target);
    this._quad.render(this._renderer);
    this._renderer.setRenderTarget(previous);
  }

  /** Zero every state target and put the solver to sleep. */
  private _clearFieldAndSleep(): void {
    for (const target of this._state) {
      this._renderToTarget(this._clearMaterial, target);
    }
    this._phase = 0;
    this._solverSleeping = true;
  }

  /** Re-anchor the field while the solver sleeps. */
  private _anchorSleepingField(originX: number, originZ: number): void {
    this._materials.originX = originX;
    this._materials.originZ = originZ;
    this._prevOriginX = originX;
    this._prevOriginZ = originZ;
    this._lastShiftX = 0;
    this._lastShiftZ = 0;
    this._firstFrame = false;
    this._genWriteIndex = 0;
  }
}
