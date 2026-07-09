/**
 * Procedural rain ripple normal perturbation.
 *
 * Purely fragment-shader-based — no buffers, no compute dispatches.
 * Tiles world space into cells, each cell spawns a raindrop on a
 * time cycle. Computes analytical concentric ring normals per-pixel
 * with an expanding wavefront, temporal decay, and spatial decay.
 *
 * Advantages over wave-equation simulation:
 * - Infinite resolution at any distance
 * - Zero GPU memory (no buffers or render targets)
 * - Zero compute cost (no dispatches)
 * - Works identically on WebGPU and WebGL
 */
import {
  cos,
  exp,
  float,
  floor,
  fract,
  Fn,
  If,
  mix,
  normalize,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

// Hardcoded ripple physics constants
const FREQUENCY = 2.5;
const SPEED = 15.0;
const TEMPORAL_DECAY_BASE = 5.0;
const SPATIAL_DECAY_BASE = 2.0;
/** Reference cell size for scaling ripple physics */
const REFERENCE_SIZE = 3.0;
/** Distance from camera where ripples reach full strength (m) */
const FADE_START = 30.0;
/** Per-drop size variation range: each drop's ripple scale is in [1 - VAR, 1 + VAR] */
const DROP_SIZE_VARIATION = 0.5;
/** How long the splash flash lasts after impact (seconds) */
const SPLASH_DURATION = 0.25;
/** Splash disk radius as a fraction of (sizeScale * dropScale) */
const SPLASH_RADIUS_FACTOR = 0.1;
/** Fixed opacity of the splash flash */
const SPLASH_OPACITY = 0.25;

/** Preset-facing parameters for rain ripples. */
export interface RainRippleParams {
  /** How quickly ripples fade (0.1–5). Scales both temporal and spatial decay. */
  decay: number;
  /** Ripple spawn density (0–1). Higher = more ripples per area. */
  density: number;
  /** Whether ripple effect is enabled. */
  enabled: boolean;
  /** Distance where ripples fully fade out from camera. */
  fadeEnd: number;
  /** Ripple cell size in world units (1–10). Controls individual ripple diameter. */
  size: number;
  /** Ripple normal perturbation strength (0–1). */
  strength: number;
}

/** Output nodes produced by {@link RainRipples.build}. */
export interface RainRipplesResult {
  /** Perturbed surface normal from ripple rings. */
  normal: Node;
  /** 0–1 additive brightness from drop impact flashes. */
  splash: Node;
}

/**
 * Procedural rain ripple effect.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link buildNormals}.
 */
export class RainRipples {
  // Uniforms
  private _enabled = uniform(0.0);
  private _time = uniform(0.0);

  // Tunable ripple uniforms
  private _decayUniform = uniform(1.0);
  private _densityUniform = uniform(1.0);
  private _sizeUniform = uniform(2.5);
  private _strengthUniform = uniform(0.5);
  private _fadeEnd = uniform(500.0);

  /** Whether ripple effect is enabled. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }
  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** How quickly ripples fade. Scales both temporal and spatial decay. */
  get decay(): number {
    return this._decayUniform.value;
  }
  set decay(value: number) {
    this._decayUniform.value = value;
  }

  /** Ripple spawn density (0–1). */
  get density(): number {
    return this._densityUniform.value;
  }
  set density(value: number) {
    this._densityUniform.value = value;
  }

  /** Ripple cell size in world units (1–10). */
  get size(): number {
    return this._sizeUniform.value;
  }
  set size(value: number) {
    this._sizeUniform.value = value;
  }

  /** Ripple normal perturbation strength. */
  get strength(): number {
    return this._strengthUniform.value;
  }
  set strength(value: number) {
    this._strengthUniform.value = value;
  }

  /** Distance where ripples fully fade out from camera. */
  get fadeEnd(): number {
    return this._fadeEnd.value;
  }
  set fadeEnd(value: number) {
    this._fadeEnd.value = value;
  }

  /** @internal Update the time uniform. Call once per frame. */
  updateTime(time: number): void {
    this._time.value = time;
  }

  /** @internal Bulk-set parameters from a preset. */
  update(params: RainRippleParams): void {
    this.decay = params.decay;
    this.density = params.density;
    this.enabled = params.enabled;
    this.fadeEnd = params.fadeEnd;
    this.size = params.size;
    this.strength = params.strength;
  }

  /**
   * @internal Build TSL nodes for ripple normal perturbation and impact splash flash.
   *
   * Tiles world space into cells. Each cell spawns a raindrop on a time
   * cycle. An expanding wavefront mask ensures rings start as a point
   * impact and propagate outward. Analytical gradients give per-pixel normals.
   * The same per-drop timing drives a brief additive white flash at impact.
   *
   * @param worldX - Fragment world X coordinate.
   * @param worldZ - Fragment world Z coordinate.
   * @param cameraWorldPos - Camera world position node (for distance fade).
   */
  build(worldX: Node, worldZ: Node, cameraWorldPos: Node): RainRipplesResult {
    const enabled = this._enabled;
    const time = this._time;
    const decay = this._decayUniform;
    const density = this._densityUniform;
    const size = this._sizeUniform;
    const strength = this._strengthUniform;
    const fadeEnd = this._fadeEnd;

    const waveNumber = float(FREQUENCY);
    const waveSpeed = float(SPEED);
    const tDecayBase = float(TEMPORAL_DECAY_BASE);
    const sDecayBase = float(SPATIAL_DECAY_BASE);
    const splashDuration = float(SPLASH_DURATION);

    const built = Fn(([_worldX, _worldZ, _camPos]: Node[]) => {
      const flatNormal = vec3(0.0, 1.0, 0.0);
      // xyz = surface normal, w = splash intensity
      const result = vec4(0.0, 1.0, 0.0, 0.0).toVar();

      If(enabled.greaterThan(0.5), () => {
        // Accumulate gradient from nearby drops
        const nx = float(0.0).toVar();
        const nz = float(0.0).toVar();
        const splashTotal = float(0.0).toVar();

        // Effective decay values scaled by the user decay parameter
        const tDecay = tDecayBase.mul(decay);
        const sDecay = sDecayBase.mul(decay);

        // Cell coordinates for this fragment
        const cellX = floor(float(_worldX).div(size));
        const cellZ = floor(float(_worldZ).div(size));

        // Ripple cycle period: each cell spawns a new drop every cyclePeriod seconds
        const cyclePeriod = float(1.5).div(density.max(0.01));

        // Scale ripple physics relative to cell size so larger cells produce
        // proportionally larger ripples. Reference size = 3.0m.
        const sizeScale = size.div(REFERENCE_SIZE);

        // Wavefront propagation speed in world units per second
        const wavefrontSpeed = waveSpeed
          .div(waveNumber.max(0.01))
          .mul(sizeScale);

        // Scale spatial decay inversely with size so ripples fill larger cells
        const scaledSDecay = sDecay.div(sizeScale);

        // Check 3x3 neighborhood, 2 time slots each (current + previous drop)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cx = cellX.add(dx);
            const cz = cellZ.add(dz);

            // Hash cell ID for drop properties
            const h1 = fract(
              sin(cx.mul(127.1).add(cz.mul(311.7))).mul(43758.5453),
            );
            const h2 = fract(
              sin(cx.mul(269.5).add(cz.mul(183.3))).mul(43758.5453),
            );
            const h3 = fract(
              sin(cx.mul(419.2).add(cz.mul(371.1))).mul(43758.5453),
            );

            // Drop position (random within cell)
            const dropX = cx.mul(size).add(h1.mul(size));
            const dropZ = cz.mul(size).add(h2.mul(size));

            // Per-drop size variation: h3 maps to [1 - VAR, 1 + VAR]
            const dropScale = h3
              .mul(DROP_SIZE_VARIATION * 2.0)
              .add(1.0 - DROP_SIZE_VARIATION);
            const dropWavefrontSpeed = wavefrontSpeed.mul(dropScale);
            const dropSDecay = scaledSDecay.div(dropScale);
            const dropWavefrontEdge = float(0.3).mul(sizeScale).mul(dropScale);

            // Two time slots for continuity (current + previous drop)
            for (let slot = 0; slot < 2; slot++) {
              // Phase offset per cell so drops aren't synchronized
              const phaseOffset = h3.mul(cyclePeriod);
              const dropAge = fract(
                time
                  .add(phaseOffset)
                  .add(float(slot).mul(cyclePeriod.mul(0.5)))
                  .div(cyclePeriod),
              ).mul(cyclePeriod);

              // Distance from fragment to drop center
              const ddx = float(_worldX).sub(dropX);
              const ddz = float(_worldZ).sub(dropZ);
              const distSq = ddx.mul(ddx).add(ddz.mul(ddz));
              const dist = sqrt(distSq.max(0.0001));

              // Expanding wavefront: ripple only exists where dist < wavefrontSpeed * age
              const wavefrontRadius = dropWavefrontSpeed.mul(dropAge);
              const wavefrontMask = smoothstep(
                wavefrontRadius,
                wavefrontRadius.sub(dropWavefrontEdge),
                dist,
              );

              // Concentric ring phase
              const ringPhase = dist
                .mul(waveNumber)
                .sub(dropAge.mul(waveSpeed));

              // Temporal decay: drops fade over their lifetime
              const temporalDecay = exp(dropAge.negate().mul(tDecay));

              // Spatial decay: rings weaken with distance from center
              const spatialDecay = exp(dist.negate().mul(dropSDecay));

              const amplitude = temporalDecay
                .mul(spatialDecay)
                .mul(wavefrontMask);

              // Analytical gradient of sin(k*r - ωt) * exp(-β*r):
              // dh/dr = [k*cos(phase) - β*sin(phase)] * exp(-β*r) * exp(-α*t)
              // dh/dx = dh/dr * (x / r)
              const cosPhase = cos(ringPhase);
              const sinPhase = sin(ringPhase);
              const radialGrad = waveNumber
                .mul(cosPhase)
                .sub(dropSDecay.mul(sinPhase));
              const gradScale = amplitude.div(dist);

              nx.addAssign(radialGrad.mul(gradScale).mul(ddx));
              nz.addAssign(radialGrad.mul(gradScale).mul(ddz));

              // Splash: brief additive white disk at the impact center.
              // Fades linearly over SPLASH_DURATION seconds, shrinks to zero at splashRadius.
              const splashRadius = sizeScale
                .mul(dropScale)
                .mul(SPLASH_RADIUS_FACTOR);
              const ageFade = float(1.0)
                .sub(dropAge.div(splashDuration))
                .max(0.0);
              const centerMask = float(1.0).sub(
                smoothstep(float(0.0), splashRadius, dist),
              );
              splashTotal.addAssign(ageFade.mul(centerMask));
            }
          }
        }

        // Scale by strength and construct normal
        const normal = normalize(
          vec3(
            nx.mul(strength).negate(),
            float(1.0),
            nz.mul(strength).negate(),
          ),
        );

        // Fade ripples and splash out linearly from FADE_START to fadeEnd in world units
        const camDx = float(_worldX).sub(float(_camPos.x));
        const camDz = float(_worldZ).sub(float(_camPos.z));
        const camDist = sqrt(camDx.mul(camDx).add(camDz.mul(camDz)));
        const distFade = float(1.0).sub(
          smoothstep(float(FADE_START), fadeEnd, camDist),
        );

        const blendedNormal = mix(flatNormal, normal, distFade);
        const fadedSplash = splashTotal
          .clamp(0.0, 1.0)
          .mul(SPLASH_OPACITY)
          .mul(distFade);
        result.assign(vec4(blendedNormal, fadedSplash));
      });

      return result;
    })(worldX, worldZ, cameraWorldPos);

    return {
      normal: built.xyz,
      splash: built.w,
    };
  }

  dispose(): void {
    // No GPU resources to clean up
  }
}
