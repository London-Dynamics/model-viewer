/**
 * Shared displaced-surface sampling for the spray compute shaders.
 *
 * Both emission and simulate need the same FFT displacement at a given
 * world XZ, and both apply the same one-step Newton correction for
 * horizontal displacement (the FFT sample at (X, Z) returns the offset of
 * the surface element that *originated* at (X, Z); the visible surface
 * height at (X, Z) is the dy of the element whose displaced XZ lands
 * there). Centralised here so the two compute shaders stay in lock-step.
 */
import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type { FloatNode, Node, StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
/** Bindings required to sample the displaced surface inside a spray compute. */
export interface SurfaceSampleBindings {
    /** Shared cascade sampler (single source of truth for scale/resolution). */
    cascadeSampler: CascadeSampler;
    /** Displacement buffers, one per cascade, coarsest first. */
    displacementBuffers: StorageBufferNode[];
}
/** XYZ displacement at a world XZ. */
export interface SurfaceDisplacement {
    dx: Node;
    dy: Node;
    dz: Node;
}
/**
 * Build a closure that returns the FFT displacement at a given world XZ.
 * Used as a primitive by `createSurfaceHeightSampler` and directly by
 * callers that need the raw displacement vector.
 */
export declare function createDisplacementSampler(bindings: SurfaceSampleBindings): (worldX: FloatNode, worldZ: FloatNode) => SurfaceDisplacement;
/**
 * Build a closure that returns the displaced surface height at a given
 * world XZ. Performs one Newton step against the horizontal displacement
 * so the returned `surfaceY` matches the visible surface at (X, Z) rather
 * than the height of the element that originated there.
 */
export declare function createSurfaceHeightSampler(bindings: SurfaceSampleBindings, meanY: UniformFloatNode): (worldX: FloatNode, worldZ: FloatNode) => FloatNode;
//# sourceMappingURL=surfaceSample.d.ts.map