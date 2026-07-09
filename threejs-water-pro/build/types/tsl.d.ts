/**
 * Type aliases for TSL (Three.js Shading Language) shader nodes.
 *
 * These types provide semantic meaning while maintaining compatibility with
 * TSL's dynamic runtime types.
 */
import { float, vec2, vec3 } from "three/tsl";
import { Node, UniformNode, StorageBufferNode as StorageBufferNodeClass, StorageTextureNode as StorageTextureNodeClass } from "three/webgpu";
export type { Node };
export type FloatNode = ReturnType<typeof float>;
export type Vec2Node = ReturnType<typeof vec2>;
export type Vec3Node = ReturnType<typeof vec3>;
export type StorageBufferNode = StorageBufferNodeClass;
export type StorageTextureNode = StorageTextureNodeClass;
export type UniformFloatNode = UniformNode<number>;
export type UniformBoolNode = UniformNode<boolean>;
/** TSL storage buffer created by instancedArray() */
export type TSLBuffer = any;
/** TSL compute shader created by Fn()().compute() */
export type TSLComputeShader = any;
/** TSL uniform node created by uniform() */
export type TSLUniformNode = any;
/** TSL shader node (generic node in the shader graph) */
export type TSLNode = any;
//# sourceMappingURL=tsl.d.ts.map