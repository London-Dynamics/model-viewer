/**
 * Caustics shader for ocean floor lighting effects.
 *
 * Samples a pre-generated seamless Voronoi texture at multiple UV
 * offsets/scales/scroll speeds. Two independently scrolling layers
 * are combined with `min()` to create natural interference patterns
 * that mimic real water caustics. Wave simulation normals distort the
 * UVs so the pattern swims in sync with wave motion.
 *
 * Supports two wave data sources (selected at build time):
 * - **Storage buffers** (WebGPU): Bilinear interpolation on storage buffer.
 * - **Textures** (WebGL): UV-tiled texture sampling.
 */
import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  float,
  floor,
  fract,
  Fn,
  If,
  mix,
  positionWorld,
  sin,
  texture,
  uniform,
  vec2,
  vec3,
  pow,
} from "three/tsl";
import type { TextureNode } from "three/webgpu";
import type { Node, StorageBufferNode, TSLBuffer } from "../types/tsl";
import { createVoronoiTexture } from "./voronoiData";

/** Options for {@link Caustics.setWaveBuffers}. */
export interface WaveCausticsBufferOptions {
  /** Normal buffer from wave simulation. */
  normalBuffer: TSLBuffer;
  /** Buffer resolution in texels. */
  resolution: number;
  /** World-space scale of the buffer. */
  scale: number;
}

/** Options for {@link Caustics.setWaveTexture}. */
export interface WaveCausticsTextureOptions {
  /** Normal texture from wave simulation (WebGL render target). */
  normalTexture: THREE.Texture;
  /** Texture resolution in texels. */
  resolution: number;
  /** World-space scale of the cascade. */
  scale: number;
}

/** Preset-facing parameters for caustics. */
export interface CausticsParams {
  /** Intensity fade with depth (0 = no fade, 1 = strong fade). */
  depthAttenuation: number;
  /** Whether caustics are active. */
  enabled: boolean;
  /** Overall brightness multiplier (0–5). */
  intensity: number;
  /** World-space tile scale. */
  scale: number;
  /** How strongly wave normals distort the procedural UVs. */
  waveDistortion: number;
}

/**
 * Caustics effect for ocean floor.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class Caustics {
  // ============= Private Uniforms =============
  private _depthAttenuation = uniform(0.4);
  private _enabled = uniform(1.0);
  private _intensity = uniform(0.61);
  private _scale = uniform(65.0);
  private _waterSize = uniform(400.0);
  private _waveDistortion = uniform(0.2);

  // Shared reference to the wave system's wind direction (radians)
  private _windDirection: Node = uniform(0.0);

  // Voronoi lookup texture (pre-generated, seamless)
  private _voronoiTexture: TextureNode;

  // Wave normal sampling (for UV distortion)
  private _waveResolution = uniform(256);
  private _waveScale = uniform(118.0);
  private _normalBuffer: StorageBufferNode | null = null;
  private _normalTexture: TextureNode;

  // Shared time reference (owned externally)
  private _time: Node;

  constructor(time: Node) {
    this._time = time;
    this._voronoiTexture = texture(createVoronoiTexture());

    const placeholder = new THREE.DataTexture(
      new Float32Array([0.5, 0.5, 1, 1]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    placeholder.needsUpdate = true;

    this._normalTexture = texture(placeholder);
  }

  // ============= Public Getters/Setters =============

  /** Intensity fade with depth (0 = no fade, 1 = strong fade). */
  get depthAttenuation(): number {
    return this._depthAttenuation.value;
  }

  set depthAttenuation(value: number) {
    this._depthAttenuation.value = value;
  }

  /** @internal Depth attenuation uniform node for shared binding. */
  get depthAttenuationNode(): Node {
    return this._depthAttenuation;
  }

  /** Whether caustics are active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Overall brightness multiplier (0–5). */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  /** World-space tile scale. */
  get scale(): number {
    return this._scale.value;
  }

  set scale(value: number) {
    this._scale.value = value;
  }

  /** How strongly wave normals distort the procedural UVs. */
  get waveDistortion(): number {
    return this._waveDistortion.value;
  }

  set waveDistortion(value: number) {
    this._waveDistortion.value = value;
  }

  /** Tile size for UV coordinate scaling. */
  get waterSize(): number {
    return this._waterSize.value;
  }

  set waterSize(value: number) {
    this._waterSize.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: CausticsParams): void {
    this.depthAttenuation = params.depthAttenuation;
    this.enabled = params.enabled;
    this.intensity = params.intensity;
    this.scale = params.scale;
    this.waveDistortion = params.waveDistortion;
  }

  /**
   * Binds the wind direction uniform node so caustics scroll in the wave direction.
   * Must be called before build().
   *
   * @param windDirection - Shared wind direction uniform node (radians).
   */
  setWindDirection(windDirection: Node): void {
    this._windDirection = windDirection;
  }

  /**
   * Set wave buffer references for caustics (WebGPU).
   * Must be called before build() for caustics to take effect.
   */
  setWaveBuffers(options: WaveCausticsBufferOptions): void {
    this._normalBuffer = options.normalBuffer as unknown as StorageBufferNode;
    this._waveResolution.value = options.resolution;
    this._waveScale.value = options.scale;
  }

  /**
   * Set wave texture reference for caustics (WebGL).
   * Must be called before build() for caustics to take effect.
   */
  setWaveTexture(options: WaveCausticsTextureOptions): void {
    this._normalTexture = texture(options.normalTexture);
    this._waveResolution.value = options.resolution;
    this._waveScale.value = options.scale;
  }

  /**
   * Updates buffer resolution and scale at runtime.
   *
   * @param resolution - Resolution in texels.
   * @param scale - World-space scale in units.
   */
  updateBufferParams(resolution: number, scale: number): void {
    this._waveResolution.value = resolution;
    this._waveScale.value = scale;
  }

  /**
   * Builds the caustics shader node graph for the ocean floor material.
   * Uses `positionWorld` for fragment position and applies depth fade.
   *
   * @returns RGB caustics color to add to the floor.
   */
  build(): Node {
    return Fn(() => {
      const result = vec3(0.0, 0.0, 0.0).toVar();

      If(this._enabled.greaterThan(0.5), () => {
        const worldPos = positionWorld;

        // Depth-dependent intensity fade
        const floorDepth = abs(worldPos.y);
        const depthFade = clamp(
          float(1.0).sub(floorDepth.mul(this._depthAttenuation).mul(0.02)),
          0.0,
          1.0,
        );

        const causticColor = this.buildPatternAtWorldPos(
          worldPos.x,
          worldPos.z,
        );
        result.assign(causticColor.mul(depthFade));
      });

      return result;
    })();
  }

  /**
   * Evaluates the caustic pattern at a given world XZ position.
   * Returns RGB caustic color with intensity, chromatic dispersion,
   * and wave distortion applied. Does NOT apply depth fade or enabled guard.
   *
   * Used by both the floor material and screen-space caustics post-processing.
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   */
  buildPatternAtWorldPos(worldX: Node, worldZ: Node): Node {
    // Distort UVs with wave normals so pattern swims with waves
    const waveNormal = this.sampleWaveNormal(worldX, worldZ);
    const distortion = vec2(waveNormal.x, waveNormal.z).mul(this._waveDistortion);

    // Scroll direction derived from wind direction
    const scrollDir = vec2(sin(this._windDirection), cos(this._windDirection));

    // Layer UVs: independent world-space scales, scrolling in wind direction
    const speed = float(0.1);
    const scroll1 = scrollDir.mul(this._time.mul(speed));
    const scroll2 = scrollDir.mul(this._time.mul(speed)).negate();
    const uv1 = vec2(worldX, worldZ)
      .div(this._scale)
      .add(distortion)
      .add(scroll1);
    const uv2 = vec2(worldX, worldZ)
      .div(this._scale.mul(1.1))
      .add(distortion)
      .add(scroll2);

    // Chromatic dispersion: offset layer 1 UVs per channel
    const d = float(0.005);
    const offsetR = vec2(d, d.mul(0.5));
    const offsetB = vec2(d.negate(), d.mul(-0.5));

    // Sample both channels: R = F1 (cell distance), G = F2−F1 (edge distance)
    // Blend between them with ridgeMix (0 = pure F1, 1 = pure edge)
    const ridgeMix = float(0.5);

    // Layer 2 sampled once, shared across chromatic channels
    const l2Sample = this._voronoiTexture.sample(uv2);
    const layer2 = mix(l2Sample.x, l2Sample.y, ridgeMix);

    const s1R = this._voronoiTexture.sample(uv1.add(offsetR));
    const r = this.combineLayers(mix(s1R.x, s1R.y, ridgeMix), layer2);

    const s1G = this._voronoiTexture.sample(uv1);
    const g = this.combineLayers(mix(s1G.x, s1G.y, ridgeMix), layer2);

    const s1B = this._voronoiTexture.sample(uv1.add(offsetB));
    const b = this.combineLayers(mix(s1B.x, s1B.y, ridgeMix), layer2);

    return pow(vec3(r, g, b).mul(this._intensity), float(4.5))
      .clamp(0.0, 1.0);
  }

  // ============= Private Helpers =============

  /**
   * Combines two Voronoi samples with min() for interference.
   *
   * @param layer1 - Voronoi texture sample for layer 1.
   * @param layer2 - Voronoi texture sample for layer 2.
   */
  private combineLayers(layer1: Node, layer2: Node): Node {
    const combined = layer1.min(layer2);

    return combined;
  }

  /**
   * Samples the wave normal at a world position and converts to [-1,1] space.
   * Used for UV distortion of procedural patterns.
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   */
  private sampleWaveNormal(worldX: Node, worldZ: Node): Node {
    const res = this._waveResolution;
    const resFloat = float(res);
    const baseRes = float(256.0);
    const effectiveScale = this._waveScale.mul(resFloat).div(baseRes);

    const sample = this._normalBuffer
      ? this.sampleNormalBuffer(worldX, worldZ, effectiveScale, res, resFloat)
      : this._normalTexture.sample(
          vec2(
            fract(worldX.div(effectiveScale).add(0.5)),
            fract(worldZ.div(effectiveScale).add(0.5)),
          ),
        );

    return sample.xyz.mul(2.0).sub(1.0);
  }

  /**
   * Bilinear interpolation on the normal storage buffer.
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   * @param effectiveScale - Resolution-adjusted scale.
   * @param res - Buffer resolution (int uniform).
   * @param resFloat - Buffer resolution (float uniform).
   */
  private sampleNormalBuffer(
    worldX: Node,
    worldZ: Node,
    effectiveScale: Node,
    res: Node,
    resFloat: Node,
  ): Node {
    const px = worldX.div(effectiveScale).add(0.5).mul(resFloat);
    const py = worldZ.div(effectiveScale).add(0.5).mul(resFloat);

    const x0Float = floor(px);
    const y0Float = floor(py);
    const fx = px.sub(x0Float);
    const fy = py.sub(y0Float);

    const x0 = x0Float.toInt().mod(res).add(res).mod(res);
    const y0 = y0Float.toInt().mod(res).add(res).mod(res);
    const x1 = x0.add(1).mod(res);
    const y1 = y0.add(1).mod(res);

    const d00 = this._normalBuffer!.element(y0.mul(res).add(x0));
    const d10 = this._normalBuffer!.element(y0.mul(res).add(x1));
    const d01 = this._normalBuffer!.element(y1.mul(res).add(x0));
    const d11 = this._normalBuffer!.element(y1.mul(res).add(x1));

    return mix(mix(d00, d10, fx), mix(d01, d11, fx), fy);
  }
}
