/**
 * Screen-space reflections (SSR) for the water surface.
 *
 * Adds reflections of scene geometry (boats, rocks, terrain) onto the water
 * via a screen-space DDA (Digital Differential Analyzer) ray march. The march
 * runs as a fullscreen post pass (see `SSRPass`); the water fragment shader
 * samples the resulting texture via {@link SSR.sample}.
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
} from "three/tsl";
import type { Node } from "./types";

// After the coarse march finds a hit, binary search narrows down the exact
// intersection within the last step interval. Each iteration halves the error,
// giving 1/16th of a step precision with 4 iterations.
const BINARY_REFINEMENT_STEPS: number = 4;

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
    if (!this._resultTexture) {
      return {
        ssrColor: vec3(1.0, 0.0, 1.0),
        ssrHitMask: float(1.0),
      };
    }
    const sampled = texture(this._resultTexture, screenUVNode);
    return {
      ssrColor: sampled.xyz,
      ssrHitMask: sampled.w,
    };
  }

  /**
   * Builds the DDA march as a fullscreen-quad colorNode. Used by `SSRPass`.
   *
   * @param depthTexture - Linear depth buffer (full-res).
   * @param sceneColorTexture - Scene color render target (for hit color).
   * @param gBufferTexture - Water reflection G-buffer with `(reflectDirWS.xyz, viewZ)`.
   * @param sceneCamera - Scene camera matrices/near/far as TSL nodes.
   */
  buildMarchNode(
    depthTexture: THREE.Texture,
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

        const rayEnd: Node = vec3(
          rayOrigin.x.add(reflectDirView.x.mul(this._maxDistance)),
          rayOrigin.y.add(reflectDirView.y.mul(this._maxDistance)),
          rayOrigin.z.add(reflectDirView.z.mul(this._maxDistance)),
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
        // register as hits.
        const viewStepSize: Node = this._maxDistance.div(marchSteps);
        const thicknessThreshold: Node = viewStepSize.mul(2.0);

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

          Loop(this._stepCount, () => {
            lastGoodUV.assign(currentUV);
            lastGoodInvZ.assign(currentInvZ);

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

            const depthSample: Node = texture(depthTexture, currentUV).toVar(
              "ssrDepthSample",
            );
            const sceneLinearDepth: Node = depthSample.x
              .mul(depthRange)
              .add(sceneNear);

            const depthDiff: Node = rayDepth.sub(sceneLinearDepth).toVar(
              "ssrDepthDiff",
            );

            If(
              depthDiff
                .greaterThan(0.0)
                .and(depthDiff.lessThan(thicknessThreshold)),
              () => {
                const refined = this.buildBinaryRefinement(
                  currentUV,
                  currentInvZ,
                  lastGoodUV,
                  lastGoodInvZ,
                  depthTexture,
                  sceneNear,
                  sceneFar,
                );

                const confidence: Node = this.buildHitConfidence(
                  refined.refinedUV,
                  refined.refinedInvZ,
                  rayOrigin.z,
                  waterViewZ,
                  depthTexture,
                  sceneNear,
                  sceneFar,
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

      return vec4(hitColor, hitMask);
    })();
  }

  // ============= Private Methods =============

  /**
   * Narrows a coarse DDA hit to sub-pixel precision via binary search
   * between the last "in front" position and the first "behind" position.
   */
  private buildBinaryRefinement(
    coarseUV: Node,
    coarseInvZ: Node,
    lastGoodUV: Node,
    lastGoodInvZ: Node,
    depthTexture: THREE.Texture,
    sceneNear: Node,
    sceneFar: Node,
  ): { refinedUV: Node; refinedInvZ: Node } {
    const refinedUV: Node = vec2(coarseUV).toVar("ssrRefUV");
    const refinedInvZ: Node = float(coarseInvZ).toVar("ssrRefInvZ");
    const refLastGoodUV: Node = vec2(lastGoodUV).toVar("ssrRefLastUV");
    const refLastGoodInvZ: Node = float(lastGoodInvZ).toVar("ssrRefLastInvZ");

    Loop(BINARY_REFINEMENT_STEPS, () => {
      const midUV: Node = refLastGoodUV.add(refinedUV).mul(0.5);
      const midInvZ: Node = refLastGoodInvZ.add(refinedInvZ).mul(0.5);
      const midDepth: Node = float(1.0).div(midInvZ).negate();

      const midDepthSample: Node = texture(depthTexture, midUV).toVar(
        "ssrMidDepthSample",
      );
      const midSceneDepth: Node = midDepthSample.x
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
   */
  private buildHitConfidence(
    refinedUV: Node,
    refinedInvZ: Node,
    rayOriginZ: Node,
    waterViewZ: Node,
    depthTexture: THREE.Texture,
    sceneNear: Node,
    sceneFar: Node,
  ): Node {
    const edgeFadeX: Node = min(
      smoothstep(float(0.0), float(0.05), refinedUV.x),
      smoothstep(float(1.0), float(0.95), refinedUV.x),
    );
    const edgeFadeY: Node = min(
      smoothstep(float(0.0), float(0.05), refinedUV.y),
      smoothstep(float(1.0), float(0.95), refinedUV.y),
    );
    const edgeFade: Node = edgeFadeX.mul(edgeFadeY);

    const refinedViewZ: Node = float(1.0).div(refinedInvZ);
    const rayTravel: Node = abs(refinedViewZ.sub(rayOriginZ));
    const distanceFade: Node = float(1.0).sub(
      smoothstep(float(0.0), this._maxDistance, rayTravel),
    );

    const refinedDepthSample: Node = texture(depthTexture, refinedUV).toVar(
      "ssrRefinedDepthSample",
    );
    const refinedSceneDepth: Node = refinedDepthSample.x
      .mul(sceneFar.sub(sceneNear))
      .add(sceneNear);
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
