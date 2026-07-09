/**
 * Centralized type definitions for threejs-water-pro.
 *
 * This module re-exports all types from:
 * - tsl.ts: TSL shader node types
 * - params.ts: Wave/sun/gerstner parameter interfaces
 * - Shader class files: Per-effect parameter interfaces
 */
export type { Node, FloatNode, Vec2Node, Vec3Node, StorageBufferNode, UniformFloatNode, UniformBoolNode, TSLBuffer, TSLComputeShader, TSLUniformNode, TSLNode, } from "./tsl";
export type { GerstnerParams, SunUniformParams, WaterSystemOptions, WaveUniformParams, } from "./params";
export type { WaterColorParams } from "../shaders/waterColor";
export type { FresnelParams } from "../shaders/fresnel";
export type { SurfaceFoamParams } from "../shaders/foamSurface";
export type { WaveFoamParams } from "../shaders/foamWaves";
export type { ShorelineFoamParams } from "../shaders/foamShoreline";
export type { SparkleParams } from "../shaders/sparkle";
export type { SSSParams } from "../shaders/sss";
export type { SSRParams } from "../shaders/ssr";
//# sourceMappingURL=index.d.ts.map