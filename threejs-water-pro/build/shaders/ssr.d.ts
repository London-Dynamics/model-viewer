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
import type { Node } from "./types";
import type { SceneDepthSampler } from "../rendering/passes/SceneDepthSampler";
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
export declare class SSR {
    private _enabled;
    private _maxDistance;
    private _strength;
    private _stepCount;
    private _thickness;
    private _resultTexture;
    /** Whether SSR is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Maximum view-space ray travel distance (world units). */
    get maxDistance(): number;
    set maxDistance(value: number);
    /** Maximum DDA steps per fragment (caps cost for long rays). */
    get stepCount(): number;
    set stepCount(value: number);
    /** Blend factor for SSR vs sky reflection (0–1). */
    get strength(): number;
    set strength(value: number);
    /** Depth-ratio threshold for rejecting false reflections from nearby geometry. */
    get thickness(): number;
    set thickness(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: SSRParams): void;
    /** Bind the SSR result texture, written by `SSRPass` and read by `sample`. */
    setResultTexture(tex: THREE.Texture): void;
    /**
     * Returns SSR composition nodes for the water fragment shader.
     *
     * Reads the SSR result texture written by `SSRPass`. The texture stores
     * `vec4(reflectionRGB, hitMask)`; the hit mask carries the strength ×
     * enabled weighting applied during the march.
     */
    sample(screenUVNode: Node): SSRResult;
    /**
     * Builds the DDA march as a fullscreen-quad colorNode. Used by `SSRPass`.
     *
     * @param sceneDepth - Normalized-linear scene depth sampler (full-res).
     * @param sceneColorTexture - Scene color render target (for hit color).
     * @param gBufferTexture - Water reflection G-buffer with `(reflectDirWS.xyz, viewZ)`.
     * @param sceneCamera - Scene camera matrices/near/far as TSL nodes.
     */
    buildMarchNode(sceneDepth: SceneDepthSampler, sceneColorTexture: THREE.Texture, gBufferTexture: THREE.Texture, sceneCamera: SceneCameraNodes): Node;
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
    private buildBinaryRefinement;
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
    private buildHitConfidence;
}
//# sourceMappingURL=ssr.d.ts.map