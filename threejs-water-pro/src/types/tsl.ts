// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Type aliases for TSL (Three.js Shading Language) shader nodes.
 *
 * These types provide semantic meaning while maintaining compatibility with
 * TSL's dynamic runtime types.
 */
import { float, vec2, vec3 } from "three/tsl";
import {
  Node,
  UniformNode,
  StorageBufferNode as StorageBufferNodeClass,
  StorageTextureNode as StorageTextureNodeClass,
} from "three/webgpu";

// Re-export base Node type for use in interfaces
export type { Node };

// Basic TSL node types derived from function return types
export type FloatNode = ReturnType<typeof float>;
export type Vec2Node = ReturnType<typeof vec2>;
export type Vec3Node = ReturnType<typeof vec3>;

// TSL storage buffer type
export type StorageBufferNode = StorageBufferNodeClass;

// TSL storage texture type (compute-writable, fragment-samplable)
export type StorageTextureNode = StorageTextureNodeClass;

// TSL uniform types
export type UniformFloatNode = UniformNode<number>;
export type UniformBoolNode = UniformNode<boolean>;

// ============= Permissive TSL Types =============
// These types are intentionally permissive because TSL's actual runtime types
// are dynamic and determined by the shader compilation process.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** TSL storage buffer created by instancedArray() */
export type TSLBuffer = any;

/** TSL compute shader created by Fn()().compute() */
export type TSLComputeShader = any;

/** TSL uniform node created by uniform() */
export type TSLUniformNode = any;

/** TSL shader node (generic node in the shader graph) */
export type TSLNode = any;
