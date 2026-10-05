// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Centralized type definitions for threejs-water-pro.
 *
 * This module re-exports all types from:
 * - tsl.ts: TSL shader node types
 * - params.ts: Wave/sun parameter interfaces
 * - Shader class files: Per-effect parameter interfaces
 */

// TSL types
export type {
  Node,
  FloatNode,
  Vec2Node,
  Vec3Node,
  StorageBufferNode,
  UniformFloatNode,
  UniformBoolNode,
  TSLBuffer,
  TSLComputeShader,
  TSLUniformNode,
  TSLNode,
} from "./tsl";

// Uniform parameter interfaces (wave/sun)
export type {
  SunUniformParams,
  WaterSystemOptions,
  WaveUniformParams,
} from "./params";

// Shader class parameter interfaces (re-exported for convenience)
export type {
  CustomWaterColorParams,
  PhysicalWaterColorParams,
  WaterColorConfig,
  WaterColorMode,
  WaterColorParams,
} from "../shaders/waterColor";
export type {
  JerlovWaterType,
  WaterConstituents,
} from "../shaders/waterConstituents";
export type { FresnelParams } from "../shaders/fresnel";
export type { SurfaceFoamParams } from "../shaders/foamSurface";
export type { WaveFoamParams } from "../shaders/foamWaves";
export type { FoamPersistenceParams } from "../shaders/foamPersistence";
export type { ShorelineFoamParams } from "../shaders/foamShoreline";
export type { SparkleParams } from "../shaders/sparkle";
export type { SSSParams } from "../shaders/sss";
export type { SSRParams } from "../shaders/ssr";
