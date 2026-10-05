// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Underwater UV distortion as a separate concern.
 *
 * Computes a noise-based UV offset for underwater pixels. The resulting
 * distorted UV node is shared by all downstream passes (underwater fog,
 * screen-space caustics) so the refraction warp is applied consistently.
 */
import {
  float,
  Fn,
  If,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "./types";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { IWaterDepthPass } from "../rendering/passes/IWaterDepthPass";
import type { WaterSubsystem } from "../systems/types";
import type { UnderwaterConfig } from "../rendering/postprocessing/types";

/**
 * Screen-space underwater UV distortion.
 *
 * Owns its own TSL uniform nodes and a pre-baked tileable gradient noise
 * texture. Call {@link buildDistortedUV} once during post-processing node
 * construction; the returned node can be fed to any pass that needs
 * refraction-warped texture sampling.
 */
export class UnderwaterDistortion implements WaterSubsystem {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _intensity = uniform(0.02);
  private _scale = uniform(3.0);
  private _speed = uniform(0.5);

  // Shared time reference (owned externally, e.g. by WaterSystem)
  private _time: Node;

  // Depth-sample source — owned by `RenderPassManager`. Sample builders
  // route through `IWaterDepthPass.sampleX(uv)` so the backend split
  // (WebGPU single-pass MIN vs. WebGL three-pass) is hidden here.
  private _waterDepthPass: IWaterDepthPass | null = null;

  // Pre-baked tileable gradient noise
  private _noiseTextureNode: ReturnType<typeof texture>;

  // Number of noise cells baked into the texture.
  // Shader UVs are divided by this to map noise-space coordinates to texture UV.
  private static readonly NOISE_PERIOD = 16;

  constructor(time: Node) {
    this._time = time;
    this._noiseTextureNode = texture(UnderwaterDistortion.createNoiseTexture());
  }

  // ============= Public Getters/Setters =============

  /** Whether distortion is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** UV offset strength. */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  /** Noise frequency. */
  get scale(): number {
    return this._scale.value;
  }

  set scale(value: number) {
    this._scale.value = value;
  }

  /** Animation speed. */
  get speed(): number {
    return this._speed.value;
  }

  set speed(value: number) {
    this._speed.value = value;
  }

  // ============= Texture Setters =============

  /**
   * Wire the water-depth source. Called once at construction and again
   * on every quality switch. Internal texture swaps inside
   * `IWaterDepthPass` propagate through its TSL nodes automatically; the
   * sample builders we hold onto don't need re-binding on resize.
   */
  bindDepthTextures(rp: RenderPassManager): void {
    this._waterDepthPass = rp.waterDepth;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  /**
   * Apply distortion params from the shared {@link UnderwaterConfig}.
   * Picks the four `distortion*` fields out of the underwater preset
   * slice so callers can hand the whole config object straight through.
   */
  update(params: UnderwaterConfig): void {
    this.enabled = params.distortionEnabled;
    this.intensity = params.distortionIntensity;
    this.scale = params.distortionScale;
    this.speed = params.distortionSpeed;
  }

  /**
   * Builds a TSL node that evaluates to a UV coordinate.
   *
   * For underwater pixels with distortion enabled, the UV is offset by
   * animated gradient noise. For above-water pixels (or when disabled),
   * the original UV is returned unchanged.
   */
  buildDistortedUV(): Node {
    const enabled = this._enabled;
    const intensity = this._intensity;
    const scale = this._scale;
    const speed = this._speed;
    const time = this._time;
    const noiseTex = this._noiseTextureNode;
    const noisePeriod = float(UnderwaterDistortion.NOISE_PERIOD);
    const wdp = this._waterDepthPass;
    if (!wdp) {
      throw new Error(
        "UnderwaterDistortion.buildDistortedUV: bindDepthTextures() must be called before building the node graph.",
      );
    }

    return Fn(() => {
      const uvCoord = uv();
      const result = vec2(uvCoord).toVar();

      // Per-pixel underwater classification using the same camera-side
      // derivation as the Underwater post-pass: closest unclipped hit's
      // facing tells us which side of the surface the camera is on.
      const unclipped = wdp.sampleUnclippedDepth(uvCoord);
      const unclippedFront = wdp.sampleUnclippedFrontDepth(uvCoord);
      const clippedAny = wdp.sampleClippedAnyDepth(uvCoord);
      const closestIsFront = unclippedFront
        .sub(unclipped)
        .lessThan(float(1e-4));
      const waterInRay = unclipped.lessThan(float(1.0));
      const isUnderwater = waterInRay.and(
        closestIsFront
          .and(unclipped.lessThan(clippedAny))
          .or(closestIsFront.not()),
      );
      const active = isUnderwater.and(enabled.greaterThan(0.5));

      If(active, () => {
        const noiseCoordX = vec2(
          uvCoord.x.mul(scale).add(time.mul(speed)),
          uvCoord.y.mul(scale).add(time.mul(speed).mul(0.7)),
        );
        const noiseCoordY = vec2(
          uvCoord.x.mul(scale).add(time.mul(speed).mul(0.8)),
          uvCoord.y.mul(scale).sub(time.mul(speed).mul(0.5)),
        );

        const noiseX = noiseTex.sample(noiseCoordX.div(noisePeriod)).x;
        const noiseY = noiseTex.sample(noiseCoordY.div(noisePeriod)).x;

        // Fade near screen edges to avoid sampling outside [0,1]
        const edgeMargin = float(0.1);
        const fadeX = smoothstep(float(0.0), edgeMargin, uvCoord.x).mul(
          smoothstep(float(1.0), float(1.0).sub(edgeMargin), uvCoord.x),
        );
        const fadeY = smoothstep(float(0.0), edgeMargin, uvCoord.y).mul(
          smoothstep(float(1.0), float(1.0).sub(edgeMargin), uvCoord.y),
        );
        const edgeFade = fadeX.mul(fadeY);

        result.addAssign(
          vec2(
            noiseX.mul(intensity).mul(edgeFade),
            noiseY.mul(intensity).mul(edgeFade),
          ),
        );
      });

      return result;
    })();
  }

  // ============= Private Static Methods =============

  /**
   * Generates a 256x256 tileable gradient noise texture.
   * Bakes Perlin-style gradient noise, replacing 16 trig operations per
   * pixel with a single texture sample.
   */
  private static createNoiseTexture(): THREE.DataTexture {
    const size = 256;
    const period = UnderwaterDistortion.NOISE_PERIOD;
    const data = new Float32Array(size * size * 4);

    const fract = (x: number): number => x - Math.floor(x);

    const hash2d = (ix: number, iy: number): [number, number] => {
      ix = ((ix % period) + period) % period;
      iy = ((iy % period) + period) % period;
      const px = ix * 127.1 + iy * 311.7;
      const py = ix * 269.5 + iy * 183.3;
      return [
        fract(Math.sin(px) * 43758.5453123) * 2 - 1,
        fract(Math.sin(py) * 43758.5453123) * 2 - 1,
      ];
    };

    const noise = (x: number, y: number): number => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;

      // Quintic interpolation
      const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
      const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

      const [g00x, g00y] = hash2d(ix, iy);
      const [g10x, g10y] = hash2d(ix + 1, iy);
      const [g01x, g01y] = hash2d(ix, iy + 1);
      const [g11x, g11y] = hash2d(ix + 1, iy + 1);

      const n00 = g00x * fx + g00y * fy;
      const n10 = g10x * (fx - 1) + g10y * fy;
      const n01 = g01x * fx + g01y * (fy - 1);
      const n11 = g11x * (fx - 1) + g11y * (fy - 1);

      const nx0 = n00 + ux * (n10 - n00);
      const nx1 = n01 + ux * (n11 - n01);
      return nx0 + uy * (nx1 - nx0);
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / size) * period;
        const ny = (y / size) * period;
        const idx = (y * size + x) * 4;
        data[idx] = noise(nx, ny);
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      }
    }

    const tex = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}
