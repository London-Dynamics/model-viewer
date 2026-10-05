// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * TSL functions for water masking and clipping.
 * Masks allow hiding water in specific screen-space regions (e.g., inside boat hulls).
 * Clip planes allow hiding water between a plane and the camera (for partial submersion).
 */
import {
  texture,
  screenUV,
  Discard,
  cameraPosition,
  positionWorld,
  dot,
  frontFacing,
  abs,
  smoothstep,
  vec3,
  float,
  sqrt,
  max,
} from "three/tsl";
import type { Texture } from "three";
import type { FloatNode, Node, Vec3Node } from "./types";

/**
 * Applies screen-space masking to water fragments.
 * Discards fragments where the mask texture indicates water should be hidden.
 *
 * Call this at the START of the fragment shader (before expensive calculations)
 * to early-out masked pixels.
 *
 * This is a shader graph builder function that adds conditional discard nodes
 * to the shader graph. Must be called within a TSL Fn() context.
 *
 * @param maskTexture - Screen-space mask texture (R channel: 1.0 = masked, 0.0 = visible)
 * @param maskEnabled - Uniform to enable/disable masking (0.0 = disabled, 1.0 = enabled)
 */
export function applyMask(maskTexture: Texture, maskEnabled: FloatNode): void {
  // Sample mask texture: R = presence, G = distance from camera
  const maskSample = texture(maskTexture, screenUV);
  const maskPresent = maskSample.r.greaterThan(0.5);
  const maskDist = maskSample.g;

  // Compare water fragment distance to mask distance —
  // if water is closer than the mask object, don't discard
  const fragDist = positionWorld.sub(cameraPosition).length();
  const waterBehindMask = fragDist.greaterThanEqual(maskDist);

  const shouldDiscard = maskEnabled
    .greaterThan(0.5)
    .and(frontFacing)
    .and(maskPresent)
    .and(waterBehindMask);
  Discard(shouldDiscard);
}

/**
 * Applies a camera-parallel clip plane to water fragments.
 * Discards fragments that are closer to the camera than the clip distance.
 * Used for partial submersion effects where water between the clip plane
 * and camera should be hidden to reveal the underwater scene.
 *
 * Call this at the START of the fragment shader (before expensive calculations)
 * to early-out clipped pixels.
 *
 * @param cameraForward - Camera's forward direction (normalized, world space)
 * @param clipDistance - Distance from camera to the clip plane
 */
export function applyClipPlane(
  cameraForward: Vec3Node,
  clipDistance: FloatNode,
): void {
  const camToFrag = positionWorld.sub(cameraPosition);

  // Primary clip: discard fragments closer than clip distance along view
  const depthAlongView = dot(camToFrag, cameraForward);
  const tooClose = depthAlongView.lessThan(clipDistance);

  // Secondary clip: discard front-face fragments above the camera within
  // clip range. Catches water surface curving over the camera at the
  // waterline that the view-aligned plane misses.
  const isAboveCamera = positionWorld.y.greaterThan(cameraPosition.y);
  const withinClipRange = camToFrag.length().lessThan(clipDistance);
  const wrappingOver = frontFacing.and(isAboveCamera).and(withinClipRange);

  Discard(tooClose.or(wrappingOver));
}

export interface ClipPlaneWaterlineParams {
  cameraForward: Vec3Node;
  clipDistance: FloatNode;
  /** Half-width of the waterline in world units (meters) */
  thickness: Node;
  /** Width of the smooth fade on each edge (0 = hard edge, higher = softer) */
  smoothness: Node;
}

export interface WaterlineResult {
  /** 0-1 factor indicating proximity to waterline (1.0 = center, 0.0 = outside) */
  factor: Node;
  /** Horizontal direction toward camera (meniscus tilt direction) */
  meniscusDir: Node;
}

/**
 * Returns waterline proximity factor and meniscus direction for physical waterline effects.
 * The meniscus direction is the horizontal vector toward the camera, used to tilt
 * the surface normal to simulate the curved water profile at contact edges.
 */
export function getClipPlaneWaterline(params: ClipPlaneWaterlineParams): WaterlineResult {
  const { cameraForward, clipDistance, thickness, smoothness } = params;

  const camToFrag = positionWorld.sub(cameraPosition);
  const depthAlongView = dot(camToFrag, cameraForward);
  const distanceToPlane = abs(depthAlongView.sub(clipDistance));

  // Smoothstep from (thickness + smoothness) down to thickness
  // At distance 0: factor = 1.0 (center of line)
  // At distance = thickness: factor starts fading
  // At distance = thickness + smoothness: factor = 0.0
  const outerEdge = thickness.add(smoothness);
  const waterlineFactor = smoothstep(outerEdge, thickness, distanceToPlane);

  // Meniscus direction: horizontal vector toward camera
  // This is the direction the water surface curves toward at contact edges
  const horizDelta = vec3(
    cameraPosition.x.sub(positionWorld.x),
    float(0.0),
    cameraPosition.z.sub(positionWorld.z),
  );
  // Normalize with epsilon guard for when camera is directly above fragment
  const horizLen = sqrt(
    horizDelta.x.mul(horizDelta.x).add(horizDelta.z.mul(horizDelta.z)),
  );
  const safeLen = max(horizLen, float(0.001));
  const meniscusDir = vec3(
    horizDelta.x.div(safeLen),
    float(0.0),
    horizDelta.z.div(safeLen),
  );

  return { factor: waterlineFactor, meniscusDir };
}
