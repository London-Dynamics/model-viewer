// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * World-fixed wave-crest foam accumulation.
 *
 * One camera-anchored half-float render-target ping-pong advanced by a single
 * fragment pass, on both backends (foam has no spatial coupling, so a fragment
 * pass is equivalent to a compute pass and lets the GPU's texture units do the
 * cascade-normal bilinear for free). Each texel maps to a world position; the
 * inject samples the FFT cascade normal textures there, sums the foldings
 * before the breaking threshold, and accumulates with decay against the
 * previous energy read at the camera-shifted UV. The sampler reads the
 * freshly written target.
 */

import * as THREE from "three/webgpu";
import { Fn, uniform, vec4 } from "three/tsl";
import type { IWaveSimulation } from "../waves";
import type { TSLUniformNode, UniformFloatNode } from "../../types/tsl";
import type { WaveUniforms } from "../../uniforms";
import type { FoamPersistence } from "../../shaders/foamPersistence";
import type { WaterSubsystem } from "../../systems/types";
import type { QualityLevel, QualityLevelConfig } from "../../config/QualityLevels";
import { viewCenterOnWater } from "../../utils/viewCenterOnWater";
import {
  createFoamAccumulationUniforms,
  type FoamAccumulationUniforms,
} from "./shaders/uniforms";
import type { IFoamFieldSampler } from "./IFoamFieldSampler";
import {
  buildFoamAccumulationMaterial,
  type FoamAccumulationMaterialResult,
  type FoamInjectCascade,
} from "./FoamAccumulationMaterial";
import { EDGE_FADE, FoamFieldSampler } from "./FoamFieldSampler";

const MAX_DELTA_TIME = 0.05;

/** Construction parameters for the world-fixed foam field. */
export interface FoamAccumulationConfig {
  /**
   * Shared persistence uniforms (owned by `WaveFoam`). The inject pass binds
   * these nodes by reference, so `water.foam.waves.persistence` drives the field.
   */
  persistence: FoamPersistence;
  /**
   * Wave-foam enable node (owned by `WaveFoam`). Read CPU-side each step: while
   * it reads 0 the field skips its update; the same node gates the shading, so
   * stale energy is never drawn. Re-enabling clears the field before injecting.
   */
  enabledNode: UniformFloatNode;
  /** Field resolution in texels per side. */
  resolution: number;
  /** Field extent in world units per side (the camera-anchored window). */
  worldSize: number;
}

export class FoamAccumulation implements WaterSubsystem {
  private readonly _renderer: THREE.WebGPURenderer;
  private _oceanSim: IWaveSimulation;
  private readonly _waveUniforms: WaveUniforms;

  private _uniforms: FoamAccumulationUniforms;

  private _resolution: number;

  // Wave-foam enable node (owned by WaveFoam); read CPU-side for the field gate.
  private readonly _enabledNode: UniformFloatNode;
  // Tracks the previous step's enable so a re-enable clears the stale field.
  private _wasEnabled = false;

  // Camera the field anchors on, and a reused scratch for the forward vector.
  private _camera: THREE.Camera | null = null;
  private readonly _forwardScratch = new THREE.Vector3();

  // World-anchoring uniforms (shared with the inject material + sampler).
  private _originX = uniform(0.0);
  private _originZ = uniform(0.0);
  private _worldSizeNode: TSLUniformNode;
  private _shiftX = uniform(0.0);
  private _shiftZ = uniform(0.0);

  /** Ping-pong energy targets; `.r` holds the foam energy. */
  private _targets!: [THREE.RenderTarget, THREE.RenderTarget];
  /** Index of the target holding the latest energy. */
  private _current = 0;

  private _material!: FoamAccumulationMaterialResult;
  private _clearMaterial: THREE.MeshBasicNodeMaterial;
  private readonly _quad: THREE.QuadMesh;

  private _sampler!: FoamFieldSampler;
  private _onSamplerRebuilt: ((sampler: IFoamFieldSampler) => void) | null = null;

  // Camera-origin tracking for the shift.
  private _prevOriginX = 0;
  private _prevOriginZ = 0;
  private _firstFrame = true;
  private _pendingReset = true;

  constructor(
    renderer: THREE.WebGPURenderer,
    oceanSim: IWaveSimulation,
    waveUniforms: WaveUniforms,
    config: FoamAccumulationConfig,
  ) {
    this._renderer = renderer;
    this._oceanSim = oceanSim;
    this._waveUniforms = waveUniforms;
    this._enabledNode = config.enabledNode;
    this._uniforms = createFoamAccumulationUniforms(config.persistence);
    this._resolution = config.resolution;
    this._worldSizeNode = uniform(config.worldSize);

    this._quad = new THREE.QuadMesh();
    this._clearMaterial = this._buildClearMaterial();
    this._buildField();
  }

  // ============================================
  // Field construction
  // ============================================

  private _buildField(): void {
    this._targets = [
      this._createTarget(this._resolution),
      this._createTarget(this._resolution),
    ];
    this._clearTargets();

    this._buildMaterial();

    // The sampler owns a texture node re-pointed at the latest target each step;
    // start it on a cleared target so the surface reads calm until the first step.
    this._sampler = new FoamFieldSampler({
      initialTexture: this._targets[0].texture,
      resolution: this._resolution,
      worldSizeNode: this._worldSizeNode,
      originXNode: this._originX,
      originZNode: this._originZ,
    });
  }

  /**
   * Build the inject material against the current wave sim's cascade normal
   * textures. Separated from {@link _buildField} so a wave sim swap
   * ({@link setOceanSim}) rebinds the injection without disturbing the
   * targets, sampler, or anchor state.
   */
  private _buildMaterial(): void {
    const cascades: FoamInjectCascade[] = [];
    for (let i = 0; i < this._oceanSim.getCascadeCount(); i++) {
      const normalTexture = this._oceanSim.getNormalTexture(i);
      const scaleNode = this._oceanSim.getScaleNode(i);
      if (normalTexture && scaleNode) {
        cascades.push({
          normalTexture,
          scaleNode,
        });
      }
    }

    this._material = buildFoamAccumulationMaterial({
      uniforms: this._uniforms,
      windDirection: this._waveUniforms.windDirection,
      cascades,
      anchor: {
        originX: this._originX,
        originZ: this._originZ,
        worldSizeNode: this._worldSizeNode,
        shiftX: this._shiftX,
        shiftZ: this._shiftZ,
      },
      resolution: this._resolution,
      initialPrevTexture: this._targets[0].texture,
    });
  }

  // ============================================
  // Public API
  // ============================================

  getSampler(): IFoamFieldSampler {
    return this._sampler;
  }

  onSamplerRebuild(callback: (sampler: IFoamFieldSampler) => void): void {
    this._onSamplerRebuilt = callback;
  }

  /** Set the camera the field anchors on (mirrors the wake). */
  setCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /**
   * Rebind the injection to a new wave simulation. Only the inject material
   * depends on the sim (its cascade normal textures); the targets and
   * sampler read the field's own targets, so a quality switch rebinds here
   * without rebuilding the field or re-handing the sampler.
   */
  setOceanSim(oceanSim: IWaveSimulation): void {
    this._oceanSim = oceanSim;
    this._material.material.dispose();
    this._buildMaterial();
  }

  get resolution(): number {
    return this._resolution;
  }
  set resolution(value: number) {
    if (value === this._resolution) return;
    for (const t of this._targets) t.dispose();
    this._material.material.dispose();
    this._resolution = value;
    this._buildField();
    this._pendingReset = true;
    this._onSamplerRebuilt?.(this._sampler);
  }

  get worldSize(): number {
    return this._worldSizeNode.value;
  }
  set worldSize(value: number) {
    this._worldSizeNode.value = value;
    this._pendingReset = true;
  }

  /**
   * Apply the quality level's foam-field config
   * ({@link WaterSubsystem.onQualityChanged}): world extent and resolution. Each
   * is guarded so a switch within the same tier is a no-op; a resolution change
   * rebuilds the field and re-binds the sampler into the surface material.
   * Enablement is quality-defaulted alongside the foam shading, not here.
   */
  onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void {
    if (config.foamFieldWorldSize !== this._worldSizeNode.value) {
      this.worldSize = config.foamFieldWorldSize;
    }
    this.resolution = config.foamFieldResolution;
  }

  // ============================================
  // Per-frame update
  // ============================================

  async step(deltaTime: number, _gpuTime: number): Promise<void> {
    // The wave-foam enable (shared with the shading) gates the field on the CPU.
    // While disabled the field is left frozen — harmless, since the same node
    // gates the shading to zero, so the stale energy is never drawn.
    if (this._enabledNode.value !== 1.0) {
      this._wasEnabled = false;
      return;
    }
    if (!this._camera) return;

    // Re-enabled since last step: clear the stale field before injecting fresh,
    // so previously-deposited energy doesn't reappear.
    if (!this._wasEnabled) this._pendingReset = true;
    this._wasEnabled = true;

    // Anchor the field on the camera's view centre on the water plane. The
    // anchor may lead the camera by at most half the window minus the rim-fade
    // band: at shallow angles the view centre races to the horizon and the
    // clamp pins the anchor forward, so capping it here keeps the camera at or
    // inside the full-foam region instead of on the faded near rim (where the
    // foam would otherwise vanish from the near foreground).
    const { x: originX, z: originZ } = viewCenterOnWater(
      this._camera,
      this._worldSizeNode.value * (0.5 - EDGE_FADE),
      this._forwardScratch,
    );

    this._uniforms.deltaTime.value = Math.min(deltaTime, MAX_DELTA_TIME);

    const res = this._resolution;
    const dx = this._worldSizeNode.value / res;
    const snappedX = Math.round(originX / dx) * dx;
    const snappedZ = Math.round(originZ / dx) * dx;

    const shiftX = this._firstFrame ? 0 : Math.round((snappedX - this._prevOriginX) / dx);
    const shiftZ = this._firstFrame ? 0 : Math.round((snappedZ - this._prevOriginZ) / dx);
    const bigJump = Math.abs(shiftX) > res * 0.5 || Math.abs(shiftZ) > res * 0.5;

    if (this._pendingReset || bigJump) {
      this._clearTargets();
      this._originX.value = snappedX;
      this._originZ.value = snappedZ;
      this._prevOriginX = snappedX;
      this._prevOriginZ = snappedZ;
      this._shiftX.value = 0;
      this._shiftZ.value = 0;
      this._firstFrame = false;
      this._pendingReset = false;
      return;
    }

    this._firstFrame = false;
    this._shiftX.value = shiftX;
    this._shiftZ.value = shiftZ;
    this._originX.value = snappedX;
    this._originZ.value = snappedZ;

    const src = this._targets[this._current];
    const dst = this._targets[1 - this._current];
    this._material.prevFoamTextureNode.value = src.texture;
    this._renderToTarget(this._material.material, dst);
    this._current = 1 - this._current;
    this._sampler.energyNode.value = dst.texture;

    this._prevOriginX = snappedX;
    this._prevOriginZ = snappedZ;
  }

  dispose(): void {
    for (const t of this._targets) t.dispose();
    this._material.material.dispose();
    this._clearMaterial.dispose();
  }

  // ============================================
  // Internal
  // ============================================

  private _createTarget(resolution: number): THREE.RenderTarget {
    // Single-channel half-float — foam energy is one scalar (`.r`) whose ~0–3
    // range and decay accumulation tolerate 16-bit precision. R16F is
    // color-renderable + linear-filterable on both backends; two bytes per texel.
    return new THREE.RenderTarget(resolution, resolution, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RedFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
  }

  private _buildClearMaterial(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial();
    material.outputNode = Fn(() => vec4(0.0, 0.0, 0.0, 1.0))();
    material.depthTest = false;
    material.depthWrite = false;
    return material;
  }

  private _renderToTarget(material: THREE.Material, target: THREE.RenderTarget): void {
    this._quad.material = material;
    const previous = this._renderer.getRenderTarget();
    this._renderer.setRenderTarget(target);
    this._quad.render(this._renderer);
    this._renderer.setRenderTarget(previous);
  }

  private _clearTargets(): void {
    for (const target of this._targets) {
      this._renderToTarget(this._clearMaterial, target);
    }
    this._current = 0;
  }
}
