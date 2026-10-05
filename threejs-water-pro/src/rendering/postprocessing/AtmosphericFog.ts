// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Atmospheric fog, applied per material via `scene.fogNode`. The fog colour
 * starts as a flat constant near the camera and blends toward the sky colour
 * (sampled in the view direction) with distance, so distant geometry matches
 * the sky at the horizon while nearby fog stays a controllable tint.
 *
 * Because the fog node runs at the end of each material's fragment shading —
 * before blending — it composes correctly through every kind of transparency:
 * each fragment fogs itself at its own distance, then blends normally. Alpha,
 * additive, alpha-tested, sprite, and arbitrarily stacked content all work
 * without any capture or decomposition.
 */
import {
  Fn,
  If,
  vec3,
  vec4,
  float,
  min,
  smoothstep,
  mix,
  pow,
  uniform,
  length,
  output,
  positionWorld,
  cameraPosition,
  materialReference,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { SkyProvider } from "../../components/sky/SkyProvider";

/** Options for {@link AtmosphericFog.createFoggedColorNode}. */
export interface FoggedColorOptions {
  /** Radial view distance (world units, camera → point). */
  distance: Node;
  /**
   * How fog consumes the colour. `"tint"` (default) mixes toward the fog
   * colour — for surfaces. `"fade"` scales toward zero — for additive light,
   * which loses energy with distance rather than taking on the fog's colour.
   */
  mode?: "fade" | "tint";
  /** World-space direction from the camera to the point (for the sky-colour blend). */
  worldDirection: Node;
}

/** Parameters for atmospheric fog. */
export interface FogParams {
  /** Constant near-distance fog colour (hex string or THREE.Color). */
  color: string;
  /** Whether fog is enabled. */
  enabled: boolean;
  /** Distance where fog reaches full intensity (world units). */
  fadeEnd: number;
  /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
  fadePower: number;
  /** Distance where fog begins (world units). */
  fadeStart: number;
  /** Distance over which the fog colour blends from `color` to the sky colour (world units). */
  skyBlendDistance: number;
}

/**
 * Atmospheric fog above water.
 *
 * `WaterSystem` assigns {@link createSceneFogNode} to `scene.fogNode`, so the
 * renderer applies the fog inside every material that keeps the default
 * `material.fog = true`. Set `material.fog = false` on backdrops (sky domes,
 * clouds, starfields) and on anything that self-fogs via the public builders.
 */
export class AtmosphericFog {
  private sky: SkyProvider | null = null;

  // Uniform nodes for fog parameters
  private _color = uniform(new THREE.Color("#b4c0cc"));
  private _fadeStart = uniform(50.0);
  private _fadeEnd = uniform(300.0);
  private _fadePower = uniform(1.0);
  private _skyBlendDistance = uniform(500.0);
  private _enabled = uniform(1.0);

  /**
   * Constant near-distance fog colour. Distant fog blends toward the sky colour
   * over `skyBlendDistance`, so this is the tint nearby geometry fades into.
   */
  get color(): THREE.Color {
    return this._color.value;
  }

  set color(value: THREE.Color | string) {
    this._color.value = new THREE.Color(value);
  }

  /** Distance where fog begins (world units). */
  get fadeStart(): number {
    return this._fadeStart.value;
  }

  set fadeStart(value: number) {
    this._fadeStart.value = value;
  }

  /** Distance where fog reaches full intensity (world units). */
  get fadeEnd(): number {
    return this._fadeEnd.value;
  }

  set fadeEnd(value: number) {
    this._fadeEnd.value = value;
  }

  /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
  get fadePower(): number {
    return this._fadePower.value;
  }

  set fadePower(value: number) {
    this._fadePower.value = value;
  }

  /**
   * Distance over which the fog colour blends from `color` (near) to the sky
   * colour (far), in world units. Smaller values reach the sky colour sooner.
   */
  get skyBlendDistance(): number {
    return this._skyBlendDistance.value;
  }

  set skyBlendDistance(value: number) {
    this._skyBlendDistance.value = value;
  }

  /** Whether fog is enabled. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Bulk-set parameters from a preset or params object. */
  update(params: FogParams): void {
    this.color = params.color;
    this.enabled = params.enabled;
    this.fadeEnd = params.fadeEnd;
    this.fadePower = params.fadePower;
    this.fadeStart = params.fadeStart;
    this.skyBlendDistance = params.skyBlendDistance;
  }

  /**
   * Set the sky for fog colour sampling.
   */
  setSky(sky: SkyProvider | null): void {
    this.sky = sky;
  }

  /**
   * The per-material fog node `WaterSystem` assigns to `scene.fogNode`. Runs
   * at the end of every fogged material's fragment shading, before blending.
   *
   * Additive-blended materials fade toward zero with distance — light loses
   * energy in fog rather than taking on its colour — and everything else
   * mixes toward the sky-blended fog colour. The blend mode is read through
   * `materialReference`, a per-object uniform, so materials that share a
   * compiled shader program still fog by their own blending.
   */
  createSceneFogNode(): Node {
    // Per-render-object uniform (THREE.AdditiveBlending === 2). Reading it at
    // render time — not build time — keeps shared shader programs correct.
    const blending = materialReference("blending", "float");

    return Fn(() => {
      const fogged = vec3(output.rgb).toVar();
      // Skip the fog math (including the sky sample) entirely when disabled.
      If(this._enabled.greaterThan(0.5), () => {
        const worldDelta = positionWorld.sub(cameraPosition);
        const dist = length(worldDelta);
        const factor = this.buildFogFactor(dist);
        If(blending.equal(float(THREE.AdditiveBlending)), () => {
          fogged.assign(vec3(output.rgb).mul(float(1.0).sub(factor)));
        }).Else(() => {
          const fogColor = this.createFogColorNode(worldDelta, dist);
          fogged.assign(mix(vec3(output.rgb), fogColor, factor));
        });
      });
      return vec4(fogged, output.a);
    })();
  }

  /**
   * TSL: fog opacity in [0, 1] at a radial view distance (world units,
   * camera → point), on the same curve the scene fog applies, gated by
   * {@link enabled}.
   *
   * The distance must be radial — `length(worldPos - cameraPos)` — not the
   * view-space depth `viewZ`; the scene fogs by radial distance, so a `viewZ`
   * self-fogged object would mismatch it toward the frame edges.
   *
   * Binds the live parameter uniforms: preset loads and setter changes
   * propagate without rebuilding.
   */
  createFogFactorNode(distance: Node): Node {
    return this.buildFogFactor(distance);
  }

  /**
   * TSL: the fog colour seen at `distance` along `worldDirection` — the flat
   * near {@link color} blending toward the sky sample over
   * {@link skyBlendDistance}, exactly as the scene fog computes it. Samples
   * the sky texture once; callers compositing many layers should hoist the
   * result. Falls back to the flat {@link color} when no sky is set, so call
   * after `water.setSky(...)`.
   */
  createFogColorNode(worldDirection: Node, distance: Node): Node {
    // The sky sampler normalizes the direction itself.
    const skyColor: Node = this.sky
      ? this.sky.createFogSampler()(worldDirection)
      : vec3(this._color);
    return this.buildFogColor(skyColor, distance);
  }

  /**
   * TSL convenience: `color` as seen through fog at a radial view distance.
   * `mode: "tint"` (default) mixes toward the fog colour; `mode: "fade"`
   * scales toward zero, for additive light. Use this to self-fog content the
   * scene fog can't reach (e.g. FX composited after post-processing) so it
   * fades on the same curve as the scene — and set `material.fog = false` on
   * such materials so the scene fog doesn't apply twice.
   */
  createFoggedColorNode(color: Node, options: FoggedColorOptions): Node {
    const factor = this.buildFogFactor(options.distance);
    if (options.mode === "fade") {
      return vec3(color).mul(float(1.0).sub(factor));
    }
    const fogColor = this.createFogColorNode(
      options.worldDirection,
      options.distance,
    );
    return mix(vec3(color), fogColor, factor);
  }

  /**
   * Fog opacity at a radial view distance:
   * `smoothstep(fadeStart, fadeEnd, distance) ^ fadePower`, gated by the
   * enable uniform. Single source of the curve — the scene fog node and the
   * public builders must never diverge.
   */
  private buildFogFactor(distance: Node): Node {
    const clampedStart = min(this._fadeStart, this._fadeEnd);
    return pow(
      smoothstep(clampedStart, this._fadeEnd, distance),
      this._fadePower,
    ).mul(this._enabled);
  }

  /**
   * Blend the flat near-fog colour toward the sky colour with distance, so
   * geometry meeting the horizon carries no colour seam. Guards against a
   * degenerate (zero) blend distance.
   */
  private buildFogColor(skyColor: Node, distance: Node): Node {
    const blendDist = this._skyBlendDistance.max(float(1.0));
    return mix(
      vec3(this._color),
      skyColor,
      smoothstep(float(0.0), blendDist, distance),
    );
  }
}
