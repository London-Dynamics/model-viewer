/**
 * Water material shader functions for TSL (Three.js Shading Language).
 * These functions are used by WaterMaterial for ocean surface rendering.
 */
export type { FloatNode, Vec3Node, StorageBufferNode, UniformFloatNode, } from "./types";
export { CascadeSampler } from "./cascadeSampler";
export { Caustics } from "./caustics";
export type { CausticsParams, WaveCausticsTextureOptions, } from "./caustics";
export type { CascadeDisplacementResult, CascadeNormalsResult, } from "./cascadeSampler";
export { WaterColor, buildReflectionSampling, normalizeWaterColorConfig, } from "./waterColor";
export type { CustomWaterColorParams, PhysicalWaterColorParams, WaterColorConfig, WaterColorParams, WaterColorMode, WaterColorBuildParams, WaterColorResult, ReflectionSamplingParams, ReflectionSamplingResult, } from "./waterColor";
export { JERLOV_WATER_TYPES, type JerlovWaterType, type WaterConstituents, } from "./waterConstituents";
export { Fresnel } from "./fresnel";
export type { FresnelParams, FresnelBuildParams, FresnelResult, } from "./fresnel";
export { SSS } from "./sss";
export type { SSSParams } from "./sss";
export { Foam } from "./foam";
export type { FoamCoords, FoamSceneState, FoamBuildParams, FoamResult, } from "./foamTypes";
export { SurfaceFoam } from "./foamSurface";
export type { SurfaceFoamParams, SurfaceFoamBuildParams, SurfaceFoamResult } from "./foamSurface";
export { WaveFoam } from "./foamWaves";
export type { WaveFoamParams, WaveFoamBuildParams, WaveFoamResult } from "./foamWaves";
export { ShorelineFoam } from "./foamShoreline";
export type { ShorelineFoamParams, ShorelineFoamBuildParams, ShorelineFoamResult } from "./foamShoreline";
export { Sparkle } from "./sparkle";
export type { SparkleParams, SparkleBuildParams } from "./sparkle";
export { SSR } from "./ssr";
export type { SSRResult as BuildSSRResult } from "./ssr";
export { SunShafts } from "./sunShafts";
export type { SunShaftsParams } from "./sunShafts";
export { applyMask, applyClipPlane, getClipPlaneWaterline } from "./mask";
export type { ClipPlaneWaterlineParams, WaterlineResult } from "./mask";
export { Waterline } from "./waterline";
export type { WaterlineParams } from "./waterline";
export { buildWaterVertexDisplacement } from "./waterVertex";
export type { WaterVertexParams, WaterVertexResult } from "./waterVertex";
export { buildWaterSurfaceNormal } from "./waterNormal";
export type { BuildWaterSurfaceNormalParams, BuildWaterSurfaceNormalResult, } from "./waterNormal";
export { buildWaterFragmentColor } from "./waterFragment";
export type { WaterTextures, WaterFragmentParams, } from "./waterFragment";
//# sourceMappingURL=index.d.ts.map