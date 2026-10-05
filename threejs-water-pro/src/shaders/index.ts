// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Water material shader functions for TSL (Three.js Shading Language).
 * These functions are used by WaterMaterial for ocean surface rendering.
 */

// Type exports
export type {
  FloatNode,
  Vec3Node,
  StorageBufferNode,
  UniformFloatNode,
} from "./types";

// Cascade sampler (WebGPU-only buffer sampling)
export { CascadeSampler } from "./cascadeSampler";

// Caustics (ocean floor lighting effects)
export { Caustics } from "./caustics";
export type {
  CausticsParams,
  WaveCausticsTextureOptions,
} from "./caustics";

export type {
  CascadeDisplacementResult,
  CascadeNormalsResult,
} from "./cascadeSampler";

// Water color class
export {
  WaterColor,
  buildReflectionSampling,
  normalizeWaterColorConfig,
} from "./waterColor";
export type {
  CustomWaterColorParams,
  PhysicalWaterColorParams,
  WaterColorConfig,
  WaterColorParams,
  WaterColorMode,
  WaterColorBuildParams,
  WaterColorResult,
  ReflectionSamplingParams,
  ReflectionSamplingResult,
} from "./waterColor";
export {
  JERLOV_WATER_TYPES,
  type JerlovWaterType,
  type WaterConstituents,
} from "./waterConstituents";

// Fresnel class
export { Fresnel } from "./fresnel";
export type {
  FresnelParams,
  FresnelBuildParams,
  FresnelResult,
} from "./fresnel";

// Subsurface scattering (physics-based forward scattering)
export { SSS } from "./sss";
export type { SSSParams } from "./sss";

// Foam orchestrator class
export { Foam } from "./foam";
export type {
  FoamCoords,
  FoamSceneState,
  FoamBuildParams,
  FoamResult,
} from "./foamTypes";

// Surface foam class
export { SurfaceFoam } from "./foamSurface";
export type { SurfaceFoamParams, SurfaceFoamBuildParams, SurfaceFoamResult } from "./foamSurface";

// Wave foam class
export { WaveFoam } from "./foamWaves";
export type { WaveFoamParams, WaveFoamBuildParams, WaveFoamResult } from "./foamWaves";

// Shoreline foam class
export { ShorelineFoam } from "./foamShoreline";
export type { ShorelineFoamParams, ShorelineFoamBuildParams, ShorelineFoamResult } from "./foamShoreline";

// Sun sparkle effects
export { Sparkle } from "./sparkle";
export type { SparkleParams, SparkleBuildParams } from "./sparkle";

// Screen-space reflections
export { SSR } from "./ssr";
export type { SSRResult as BuildSSRResult } from "./ssr";

// Sun shafts (god rays)
export { SunShafts } from "./sunShafts";
export type { SunShaftsParams } from "./sunShafts";

// Masking and clipping
export { applyMask, applyClipPlane, getClipPlaneWaterline } from "./mask";
export type { ClipPlaneWaterlineParams, WaterlineResult } from "./mask";

// Waterline class
export { Waterline } from "./waterline";
export type { WaterlineParams } from "./waterline";

// Vertex displacement builder (used by WaterSurfaceMaterial)
export { buildWaterVertexDisplacement } from "./waterVertex";
export type { WaterVertexParams, WaterVertexResult } from "./waterVertex";

// Surface normal builder (shared between water fragment and SSR G-buffer pass)
export { buildWaterSurfaceNormal } from "./waterNormal";
export type {
  BuildWaterSurfaceNormalParams,
  BuildWaterSurfaceNormalResult,
} from "./waterNormal";

// Fragment color builder (used by WaterSurfaceMaterial)
export { buildWaterFragmentColor } from "./waterFragment";
export type {
  WaterTextures,
  WaterFragmentParams,
} from "./waterFragment";
