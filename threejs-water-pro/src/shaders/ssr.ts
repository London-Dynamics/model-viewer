// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Screen-space reflections (SSR) for the water surface.
 *
 * Adds reflections of above-water scene geometry (boats, rocks, cliffs) onto
 * the water via a screen-space DDA (Digital Differential Analyzer) ray march.
 * The march runs as a fullscreen post pass (see `SSRPass`); the water fragment
 * shader samples the resulting texture via {@link SSR.sample}.
 *
 * Hits below the water surface are rejected. The scene capture excludes the
 * water, so the seabed shows through behind every water pixel; without this
 * guard the screen-space march registers the ocean floor as a reflected
 * surface and paints its caustics across the water as false bright streaks.
 *
 * DDA vs fixed 3D stepping:
 * - Fixed stepping uses the same number of samples regardless of screen
 *   coverage. Short rays oversample, long rays undersample (miss geometry).
 * - DDA adapts: step count = ray length in pixels. Every sample is
 *   meaningful, no geometry is skipped, and short rays are cheap.
 * - `stepCount` acts as a max cap to bound worst-case cost for long rays.
 */
import * as THREE from "three/webgpu";
import {
  abs,
  float,
  max,
  vec2,
  vec3,
  vec4,
  texture,
  transformDirection,
  uniform,
  min,
  smoothstep,
  screenSize,
  screenUV,
  uv,
  dot,
  sin,
  fract,
  Loop,
  Break,
  Fn,
  If,
  select,
} from "three/tsl";
import type { Node } from "./types";
import type { SceneDepthSampler } from "../rendering/passes/SceneDepthSampler";

// After the coarse march finds a hit, binary search narrows down the exact
// intersection within the last step interval. Each iteration halves the error,
// giving 1/16th of a step precision with 4 iterations.
const BINARY_REFINEMENT_STEPS: number = 4;

// Upper bound (world units) on the thin-surface acceptance gate below. Without
// this cap, rays capped by stepCount (rather than pixel-limited) derive their
// gate from rayLength / stepCount, which grows unbounded for long rays and
// starts accepting hits against whatever surface happens to be within tens of
// world units of the ray — the wrong geometry entirely. Three.js's own SSR
// reference (examples/jsm/tsl/display/SSRNode.js) floors/caps this gate with a
// small fixed thickness rather than deriving it purely from step coarseness;
// this mirrors that. A capped, coarse ray that can't resolve thin geometry
// within this bound now misses (falls back to the sky reflection) instead of
// mis-hitting.
const MAX_THICKNESS_THRESHOLD: number = 2.0;

// Normalized-depth cutoff above which a sampled pixel is treated as sky /
// background rather than geometry. The capture's hardware depth clears to the
// far plane (1.0) and sky meshes write no depth, so every sky pixel reads
// exactly 1.0. A grazing reflection ray aimed at the horizon eventually marches
// past the far plane and registers a spurious crossing against that cleared
// depth, sampling the bright horizon color as a mirror-sharp streak. SSR only
// reflects scene geometry — the sky reflection is supplied separately by the
// prefiltered environment — so any hit at or beyond this depth is rejected and
// the fragment falls back to that environment reflection. Geometry within 0.1%
// of the far plane is effectively at infinity and would not carry a meaningful
// sharp reflection either.
const SKY_DEPTH_THRESHOLD: number = 0.999;

/** Preset-facing parameters for screen-space reflections. */
export interface SSRParams {
  /** Whether SSR is active. */
  enabled: boolean;
  /** Blend factor for SSR vs sky reflection (0–1). */
  strength: number;
}

/** Output nodes produced by {@link SSR.sample}. */
export interface SSRResult {
  /** RGB color sampled from the scene at the hit point. */
  ssrColor: Node;
  /** 0–1 confidence mask controlling blend with the sky fallback. */
  ssrHitMask: Node;
}

/** Scene-camera matrices/uniforms passed into {@link SSR.buildMarchNode}. */
export interface SceneCameraNodes {
  viewMatrix: Node;
  projectionMatrix: Node;
  projectionMatrixInverse: Node;
  near: Node;
  far: Node;
}

/**
 * Screen-space reflections for the water surface.
 *
 * Owns the SSR uniform nodes. The DDA march runs in {@link buildMarchNode}
 * (used as the colorNode of `SSRPass`'s fullscreen material). The water
 * fragment composes the result by sampling the SSR result texture via
 * {@link sample}.
 */
export class SSR {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _maxDistance = uniform(100.0);
  private _strength = uniform(0.8);
  private _stepCount = uniform(32.0);
  private _thickness = uniform(0.1);

  // ============= Result texture (set by RenderPassManager) =============
  private _resultTexture: THREE.Texture | null = null;

  // ============= Public Getters/Setters =============

  /** Whether SSR is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Maximum view-space ray travel distance (world units). */
  get maxDistance(): number {
    return this._maxDistance.value;
  }

  set maxDistance(value: number) {
    this._maxDistance.value = value;
  }

  /** Maximum DDA steps per fragment (caps cost for long rays). */
  get stepCount(): number {
    return this._stepCount.value;
  }

  set stepCount(value: number) {
    this._stepCount.value = value;
  }

  /** Blend factor for SSR vs sky reflection (0–1). */
  get strength(): number {
    return this._strength.value;
  }

  set strength(value: number) {
    this._strength.value = value;
  }

  /** Depth-ratio threshold for rejecting false reflections from nearby geometry. */
  get thickness(): number {
    return this._thickness.value;
  }

  set thickness(value: number) {
    this._thickness.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: SSRParams): void {
    this.enabled = params.enabled;
    this.strength = params.strength;
  }

  /** Bind the SSR result texture, written by `SSRPass` and read by `sample`. */
  setResultTexture(tex: THREE.Texture): void {
    this._resultTexture = tex;
  }

  /**
   * Returns SSR composition nodes for the water fragment shader.
   *
   * Reads the SSR result texture written by `SSRPass`. The texture stores
   * `vec4(reflectionRGB, hitMask)`; the hit mask carries the strength ×
   * enabled weighting applied during the march.
   */
  sample(screenUVNode: Node): SSRResult {
    const resultTexture = this._resultTexture;
    if (!resultTexture) {
      // Zero-confidence miss: the composite falls back to the sky sample
      // instead of flashing a placeholder color while the result texture
      // is unbound (quality switches, target rebuilds).
      return {
        ssrColor: vec3(0.0, 0.0, 0.0),
        ssrHitMask: float(0.0),
      };
    }
    const ssrColor = vec3(0.0, 0.0, 0.0).toVar("ssrSampleColor");
    const ssrHitMask = float(0.0).toVar("ssrSampleHitMask");

    // `_enabled` is uniform across the draw, so the entire water surface takes
    // the same branch. Disabled quality levels avoid the texture read rather
    // than sampling a cleared result and multiplying its hit mask by zero.
    If(this._enabled.greaterThan(0.5), () => {
      const sampled = texture(resultTexture, screenUVNode);
      ssrColor.assign(sampled.xyz);
      ssrHitMask.assign(sampled.w);
    });

    return {
      ssrColor,
      ssrHitMask,
    };
  }

  /**
   * Builds the DDA march as a fullscreen-quad colorNode. Used by `SSRPass`.
   *
   * @param sceneDepth - Normalized-linear scene depth sampler (full-res).
   * @param sceneColorTexture - Scene color render target (for hit color).
   * @param gBufferTexture - Water reflection G-buffer with `(reflectDirWS.xyz, viewZ)`.
   * @param sceneCamera - Scene camera matrices/near/far as TSL nodes.
   */
  buildMarchNode(
    sceneDepth: SceneDepthSampler,
    sceneColorTexture: THREE.Texture,
    gBufferTexture: THREE.Texture,
    sceneCamera: SceneCameraNodes,
  ): Node {
    const {
      viewMatrix: sceneViewMatrix,
      projectionMatrix: sceneProjectionMatrix,
      projectionMatrixInverse: sceneProjectionMatrixInverse,
      near: sceneNear,
      far: sceneFar,
    } = sceneCamera;
    const depthRange: Node = sceneFar.sub(sceneNear);

    return Fn(() => {
      const gSample: Node = texture(gBufferTexture, uv()).toVar("ssrGSample");
      const reflectDirWS: Node = gSample.xyz;
      const waterViewZ: Node = gSample.w;

      const hitColor: Node = vec3(0.0, 0.0, 0.0).toVar("ssrHitColor");
      const hitMask: Node = float(0.0).toVar("ssrHitMask");

      If(waterViewZ.greaterThan(0.0), () => {
        // Reconstruct the view-space ray origin by inverse-projecting the
        // pass's UV through the near plane (NDC z = 0) and then scaling so
        // the ray's view-space z equals −waterViewZ. `uv()` is Y-down,
        // NDC is Y-up — the flip here and the one in `viewPosToScreenUV`
        // cancel for screen-space sampling.
        const ndc: Node = vec4(
          uv().x.mul(2.0).sub(1.0),
          float(1.0).sub(uv().y.mul(2.0)),
          float(0.0),
          float(1.0),
        );
        const viewH: Node = sceneProjectionMatrixInverse.mul(ndc);
        const viewRay: Node = vec3(
          viewH.x.div(viewH.w),
          viewH.y.div(viewH.w),
          viewH.z.div(viewH.w),
        );
        const rayScale: Node = waterViewZ.negate().div(viewRay.z);
        const rayOrigin: Node = vec3(
          viewRay.x.mul(rayScale),
          viewRay.y.mul(rayScale),
          viewRay.z.mul(rayScale),
        ).toVar("ssrRayOrigin");

        const reflectDirView: Node = transformDirection(
          sceneViewMatrix,
          reflectDirWS,
        ).toVar("ssrReflectDirView");

        // Clamp the ray so its endpoint stays in front of the near plane.
        // Grazing-angle facets reflect toward the camera (positive view-space
        // z); an unclamped endpoint crosses the 1/z singularity, and
        // projecting a behind-camera point mirrors its UV, marching the DDA
        // over unrelated pixels. Reference: McGuire & Mara, "Efficient GPU
        // Screen-Space Ray Tracing", JCGT 2014.
        const rayLength: Node = select(
          reflectDirView.z.greaterThan(0.0),
          min(
            this._maxDistance,
            sceneNear
              .negate()
              .sub(rayOrigin.z)
              .div(max(reflectDirView.z, 1e-6)),
          ),
          this._maxDistance,
        ).toVar("ssrRayLength");

        const rayEnd: Node = vec3(
          rayOrigin.x.add(reflectDirView.x.mul(rayLength)),
          rayOrigin.y.add(reflectDirView.y.mul(rayLength)),
          rayOrigin.z.add(reflectDirView.z.mul(rayLength)),
        ).toVar("ssrRayEnd");

        const startUV: Node = viewPosToScreenUV(
          rayOrigin,
          sceneProjectionMatrix,
        ).toVar("ssrStartUV");
        const endUV: Node = viewPosToScreenUV(
          rayEnd,
          sceneProjectionMatrix,
        ).toVar("ssrEndUV");

        const startPixel: Node = startUV.mul(screenSize).toVar("ssrStart");
        const endPixel: Node = endUV.mul(screenSize).toVar("ssrEnd");

        const deltaPixel: Node = endPixel.sub(startPixel);
        const pixelDist: Node = max(abs(deltaPixel.x), abs(deltaPixel.y));
        const marchSteps: Node = min(pixelDist, this._stepCount)
          .max(1.0)
          .toVar("ssrMarchSteps");

        // Thickness threshold for hit detection, scaled to the view-space
        // step length. A hit fires when the ray is just barely behind the
        // scene (about to cross from behind to in-front). The threshold
        // bounds the depthDiff magnitude so silhouette edges — where scene
        // depth jumps discontinuously between adjacent pixels — don't
        // register as hits. Capped at MAX_THICKNESS_THRESHOLD so long,
        // stepCount-capped rays don't accept hits against unrelated geometry
        // far along the ray (see comment at MAX_THICKNESS_THRESHOLD).
        const viewStepSize: Node = rayLength.div(marchSteps);
        const thicknessThreshold: Node = min(
          viewStepSize.mul(2.0),
          float(MAX_THICKNESS_THRESHOLD),
        );

        If(this._enabled.greaterThan(0.5), () => {
          const stepUV: Node = endUV.sub(startUV).div(marchSteps);

          // Perspective-correct depth interpolation: 1/z is linear in screen
          // space. We interpolate 1/z and recover z at each step.
          const startInvZ: Node = float(1.0).div(rayOrigin.z);
          const endInvZ: Node = float(1.0).div(rayEnd.z);
          const stepInvZ: Node = endInvZ.sub(startInvZ).div(marchSteps);

          // Per-pixel jitter: offset each pixel's starting position by a
          // random fraction of one step. Without this, all pixels step in
          // lockstep, creating visible banding.
          const jitter: Node = fract(
            sin(dot(screenUV, vec2(127.1, 311.7))).mul(43758.5453),
          );

          const currentUV: Node = startUV
            .add(stepUV.mul(jitter))
            .toVar("ssrCurUV");
          const currentInvZ: Node = startInvZ
            .add(stepInvZ.mul(jitter))
            .toVar("ssrCurInvZ");

          const lastGoodUV: Node = startUV.toVar("ssrLastUV");
          const lastGoodInvZ: Node = startInvZ.toVar("ssrLastInvZ");

          Loop(marchSteps, () => {
            currentUV.addAssign(stepUV);
            currentInvZ.addAssign(stepInvZ);

            const inBounds: Node = currentUV.x
              .greaterThanEqual(0.0)
              .and(currentUV.x.lessThanEqual(1.0))
              .and(currentUV.y.greaterThanEqual(0.0))
              .and(currentUV.y.lessThanEqual(1.0));

            If(inBounds.not(), () => {
              Break();
            });

            const rayDepth: Node = float(1.0).div(currentInvZ).negate();

            const depthSample: Node = sceneDepth
              .sample(currentUV)
              .toVar("ssrDepthSample");
            const sceneLinearDepth: Node = depthSample
              .mul(depthRange)
              .add(sceneNear);

            const depthDiff: Node = rayDepth
              .sub(sceneLinearDepth)
              .toVar("ssrDepthDiff");

            // `lastGood` is the in-front end of the refinement bracket, so it
            // tracks only samples that are actually in front.
            If(depthDiff.lessThanEqual(0.0), () => {
              lastGoodUV.assign(currentUV);
              lastGoodInvZ.assign(currentInvZ);
            }).Else(() => {
              // Behind the depth buffer. The coarse per-step sample lands at
              // a per-pixel jittered phase (see jitter above), so its raw
              // depthDiff is not a reliable thin-surface measurement — near a
              // silhouette edge, one pixel's jitter phase can land inside the
              // thickness window while its neighbor's lands just outside,
              // producing visible per-pixel noise. The crossing triggers
              // refinement; the thin-surface gate is then re-checked against
              // the refined, sub-step-precision depthDiff, which converges to
              // the true crossing point regardless of jitter phase.
              //
              // Every behind-step refines, not just the first crossing: a
              // grazing ray passes behind the seabed well before it reaches a
              // hull, and the hull is nearer still, so the ray never returns
              // to the front along the way.
              const refined = this.buildBinaryRefinement(
                currentUV,
                currentInvZ,
                lastGoodUV,
                lastGoodInvZ,
                sceneDepth,
                sceneNear,
                sceneFar,
              );

              const refinedRayDepth: Node = float(1.0)
                .div(refined.refinedInvZ)
                .negate();
              const refinedDepthSample: Node = sceneDepth
                .sample(refined.refinedUV)
                .toVar("ssrRefinedCoarseDepthSample");
              const refinedSceneLinearDepth: Node = refinedDepthSample
                .mul(depthRange)
                .add(sceneNear);
              const refinedDepthDiff: Node = refinedRayDepth.sub(
                refinedSceneLinearDepth,
              );

              // Reject hits against the sky / far-plane clear: those pixels
              // carry the bright horizon color but no real geometry, and the
              // sky reflection is handled by the prefiltered environment.
              const hitIsGeometry: Node =
                refinedDepthSample.lessThan(SKY_DEPTH_THRESHOLD);

              // Reject hits behind the wave-displaced water surface at the
              // hit's pixel. The capture excludes the water, so the seabed
              // shows behind every water pixel; a crossing there is the
              // ocean floor, not a real reflection. The G-buffer alpha is
              // the water surface's viewZ (0 where no water rendered).
              const hitWaterViewZ: Node = texture(
                gBufferTexture,
                refined.refinedUV,
              ).w;
              // Depth-relative slack: the G-buffer's half-float viewZ
              // quantizes at ~z/2048, so a hard comparison flickers on
              // geometry right at the waterline.
              const waterDepthBias: Node = max(
                hitWaterViewZ.mul(0.002),
                0.05,
              );
              const hitAboveWater: Node = hitWaterViewZ
                .lessThanEqual(0.0)
                .or(
                  refinedSceneLinearDepth.lessThan(
                    hitWaterViewZ.add(waterDepthBias),
                  ),
                );

              If(
                refinedDepthDiff
                  .lessThan(thicknessThreshold)
                  .and(hitIsGeometry)
                  .and(hitAboveWater),
                () => {
                  const confidence: Node = this.buildHitConfidence(
                    refined.refinedUV,
                    refined.refinedInvZ,
                    rayOrigin.z,
                    reflectDirView.z,
                    waterViewZ,
                    refinedSceneLinearDepth,
                  );

                  const sceneColor: Node = texture(
                    sceneColorTexture,
                    refined.refinedUV,
                  ).toVar("ssrSceneColorSample");
                  hitColor.assign(sceneColor.xyz);
                  hitMask.assign(confidence);

                  Break();
                },
              );
            });
          });
        });
      });

      return vec4(hitColor, hitMask);
    })();
  }

  // ============= Private Methods =============

  /**
   * Narrows a coarse DDA hit to sub-pixel precision by bisecting the
   * interval that brackets the crossing.
   *
   * @param behindUV - UV of a sample behind the depth buffer.
   * @param behindInvZ - Inverse view Z at `behindUV`.
   * @param inFrontUV - UV of a sample in front of the depth buffer. The
   *   bisection assumes the crossing lies between the two, so this must be
   *   in front — not merely the previously visited step.
   * @param inFrontInvZ - Inverse view Z at `inFrontUV`.
   */
  private buildBinaryRefinement(
    behindUV: Node,
    behindInvZ: Node,
    inFrontUV: Node,
    inFrontInvZ: Node,
    sceneDepth: SceneDepthSampler,
    sceneNear: Node,
    sceneFar: Node,
  ): { refinedUV: Node; refinedInvZ: Node } {
    const refinedUV: Node = vec2(behindUV).toVar("ssrRefUV");
    const refinedInvZ: Node = float(behindInvZ).toVar("ssrRefInvZ");
    const refLastGoodUV: Node = vec2(inFrontUV).toVar("ssrRefLastUV");
    const refLastGoodInvZ: Node = float(inFrontInvZ).toVar("ssrRefLastInvZ");

    Loop(BINARY_REFINEMENT_STEPS, () => {
      const midUV: Node = refLastGoodUV.add(refinedUV).mul(0.5);
      const midInvZ: Node = refLastGoodInvZ.add(refinedInvZ).mul(0.5);
      const midDepth: Node = float(1.0).div(midInvZ).negate();

      const midDepthSample: Node = sceneDepth
        .sample(midUV)
        .toVar("ssrMidDepthSample");
      const midSceneDepth: Node = midDepthSample
        .mul(sceneFar.sub(sceneNear))
        .add(sceneNear);
      const midDiff: Node = midDepth.sub(midSceneDepth);

      If(midDiff.greaterThan(0.0), () => {
        refinedUV.assign(midUV);
        refinedInvZ.assign(midInvZ);
      }).Else(() => {
        refLastGoodUV.assign(midUV);
        refLastGoodInvZ.assign(midInvZ);
      });
    });

    return { refinedUV, refinedInvZ };
  }

  /**
   * Computes a 0–1 confidence value combining edge fade, distance fade,
   * depth-ratio fade, strength, and enabled multipliers.
   *
   * @param refinedUV - UV after binary refinement.
   * @param refinedInvZ - Inverse view Z after binary refinement.
   * @param rayOriginZ - View-space Z of the ray origin.
   * @param reflectDirViewZ - Z component of the unit view-space ray direction.
   * @param waterViewZ - View-space depth of the water fragment the ray left.
   * @param refinedSceneDepth - Linear scene depth the march already sampled
   *   at `refinedUV`.
   */
  private buildHitConfidence(
    refinedUV: Node,
    refinedInvZ: Node,
    rayOriginZ: Node,
    reflectDirViewZ: Node,
    waterViewZ: Node,
    refinedSceneDepth: Node,
  ): Node {
    const edgeFadeX: Node = min(
      smoothstep(float(0.0), float(0.05), refinedUV.x),
      smoothstep(float(0.95), float(1.0), refinedUV.x).oneMinus(),
    );
    const edgeFadeY: Node = min(
      smoothstep(float(0.0), float(0.05), refinedUV.y),
      smoothstep(float(0.95), float(1.0), refinedUV.y).oneMinus(),
    );
    const edgeFade: Node = edgeFadeX.mul(edgeFadeY);

    // Distance along the ray, recovered from its depth component:
    // |Δz| = travel × |dirZ|. The guard keeps near-lateral rays
    // (dirZ ≈ 0) finite; they underestimate travel slightly.
    const refinedViewZ: Node = float(1.0).div(refinedInvZ);
    const rayTravel: Node = abs(refinedViewZ.sub(rayOriginZ)).div(
      max(abs(reflectDirViewZ), 1e-4),
    );
    const distanceFade: Node = float(1.0).sub(
      smoothstep(float(0.0), this._maxDistance, rayTravel),
    );

    const depthRatio: Node = refinedSceneDepth.div(waterViewZ.add(0.0001));
    const depthRatioFade: Node = smoothstep(
      this._thickness,
      this._thickness.add(0.1),
      depthRatio,
    );

    return edgeFade
      .mul(distanceFade)
      .mul(depthRatioFade)
      .mul(this._strength)
      .mul(this._enabled);
  }
}

// ============= Module-level TSL helpers =============

/**
 * Projects a view-space position to screen UV. Applies the scene camera's
 * projection matrix, perspective divide, and an NDC→UV remap with a Y flip
 * to land in the Y-down convention used by `uv()` and `screenUV`.
 */
function viewPosToScreenUV(viewPos: Node, projectionMatrix: Node): Node {
  const clipPos: Node = projectionMatrix.mul(vec4(viewPos, 1.0));
  const ndcXY: Node = clipPos.xy.div(clipPos.w);
  const uvRaw: Node = ndcXY.mul(0.5).add(0.5);
  return vec2(uvRaw.x, uvRaw.y.oneMinus());
}
