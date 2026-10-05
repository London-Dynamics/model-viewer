/**
 * Interfaces for wave simulation implementations.
 * Supports both WebGPU (compute shaders) and WebGL (render-to-texture) backends.
 */
import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { TSLBuffer } from "../../types/tsl";
/**
 * Capabilities of a wave simulation implementation.
 */
export interface WaveCapabilities {
    /** Whether the simulation supports multiple cascade levels */
    hasCascades: boolean;
    /** Whether GPU storage buffers are available for direct sampling */
    hasStorageBuffers: boolean;
    /** Number of active cascade levels (determined by quality config) */
    cascadeCount: number;
    /** The rendering backend being used */
    backend: "webgpu" | "webgl";
}
/**
 * TSL nodes for sampling wave displacement in the vertex shader.
 * Used by materials to apply wave displacement.
 */
export interface WaveDisplacementNodes {
    /**
     * Sample displacement at a world position.
     * @param worldX - X coordinate in world space
     * @param worldZ - Z coordinate in world space
     * @returns vec3 node with (dx, dy, dz) displacement
     */
    sampleDisplacement: (worldX: Node, worldZ: Node) => Node;
}
/**
 * TSL nodes for sampling wave normals in the fragment shader.
 * Used by materials to compute surface lighting.
 */
export interface WaveNormalNodes {
    /**
     * Sample normal at a world position.
     * @param worldX - X coordinate in world space
     * @param worldZ - Z coordinate in world space
     * @returns vec3 node with surface normal
     */
    sampleNormal: (worldX: Node, worldZ: Node) => Node;
}
/**
 * Common interface for wave simulation implementations.
 * Both WebGPU and WebGL backends implement this interface.
 *
 * Wave physics parameters (windSpeed, gravity, etc.) are NOT on this interface.
 * They live in WaveUniforms as the single source of truth, and the simulation
 * binds to those uniform nodes directly.
 */
export interface IWaveSimulation {
    /** Animation speed multiplier (used to scale delta time) */
    animationSpeed: number;
    /** Initialize compute shaders and resources */
    init(): void;
    /**
     * Initialize buffers with GPU synchronization.
     * Must be called after init() and before creating materials.
     */
    initializeBuffers(renderer: THREE.WebGPURenderer): Promise<void>;
    /** Update the simulation for a new frame */
    update(deltaTime: number): void | Promise<void>;
    /**
     * Override the simulation's internal time accumulator with an absolute time.
     * Used by `WaterSystem.syncToTick(n)` so multiple clients can agree on the
     * wave phase. Does not advance the simulation by itself — the next
     * `update()` call drives the GPU using the new time.
     */
    setTime(t: number): void;
    /** Dispose of all resources */
    dispose(): void;
    /** Get the capabilities of this simulation implementation */
    getCapabilities(): WaveCapabilities;
    /**
     * Get TSL nodes for displacement sampling.
     * Used by materials when storage buffers aren't available.
     */
    getDisplacementNodes(): WaveDisplacementNodes;
    /**
     * Get TSL nodes for normal sampling.
     * Used by materials when storage buffers aren't available.
     */
    getNormalNodes(): WaveNormalNodes;
    /** Number of active cascades. */
    getCascadeCount(): number;
    /** Get the displacement storage buffer for a cascade. Returns null on WebGL (uses textures). */
    getDisplacementBuffer(cascadeIndex?: number): TSLBuffer | null;
    /**
     * Get the normal texture for a cascade. Available on both backends:
     * WebGL renders normals to a texture target; WebGPU writes an authoritative
     * RGBA16F StorageTexture in `computeNormals`. Compute and fragment consumers
     * sample it with hardware filtering.
     */
    getNormalTexture(cascadeIndex?: number): THREE.Texture | null;
    /** Get the resolution for a cascade. */
    getResolution(cascadeIndex?: number): number;
    /** Get the world-space scale for a cascade. */
    getScale(cascadeIndex?: number): number;
    /**
     * Get a cascade's world-space scale uniform node (single source of truth,
     * synced on cascade-config changes). Consumers that sample a cascade at a
     * world position (e.g. the world-fixed foam field) bind to it. Null if the
     * cascade is absent.
     */
    getScaleNode(cascadeIndex?: number): Node | null;
    /**
     * Resize the whole cascade set from a single largest tile size. Finer
     * cascades derive from `maxScale` and their resolution (see
     * `deriveCascadeScale`), and band edges are recomputed.
     */
    setMaxScale(maxScale: number): void;
}
//# sourceMappingURL=IWaveSimulation.d.ts.map