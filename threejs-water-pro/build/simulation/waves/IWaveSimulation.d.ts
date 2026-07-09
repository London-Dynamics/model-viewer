/**
 * Interfaces for wave simulation implementations.
 * Supports both WebGPU (compute shaders) and WebGL (render-to-texture) backends.
 */
import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { TSLBuffer } from "../../types/tsl";
import type { InternalGerstnerParams } from "../../shaders/gerstner";
import type { CascadeConfig } from "./types";
/**
 * Capabilities of a wave simulation implementation.
 */
export interface WaveCapabilities {
    /** Whether the simulation supports multiple cascade levels */
    hasCascades: boolean;
    /** Whether GPU storage buffers are available for direct sampling */
    hasStorageBuffers: boolean;
    /** Whether Jacobian-based foam detection is supported */
    hasJacobianFoam: boolean;
    /** Whether persistent per-cascade foam accumulation buffers are supported */
    hasPersistentFoamBuffer: boolean;
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
/** Result from sampling wave normals with per-cascade eigenvalues. */
export interface WaveNormalSampleResult {
    /** Surface normal (vec3). */
    normal: Node;
    /** Wave-cascade eigenvalue for foam detection (0-1). Lower = more folding/steeper. */
    eigen0: Node;
    /** Ripple-cascade eigenvalue (0-1). Neutral (1.0) when no ripple cascade is active. */
    eigen1: Node;
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
    /**
     * Sample normal and per-cascade eigenvalues at a world position.
     * Eigenvalues are used for wave crest foam detection: `eigen0` weights the
     * wave cascade, `eigen1` the ripple cascade.
     * @param worldX - X coordinate in world space
     * @param worldZ - Z coordinate in world space
     * @returns Object with normal and per-cascade eigenvalue nodes
     */
    sampleNormalAndEigenvalue?: (worldX: Node, worldZ: Node) => WaveNormalSampleResult;
}
export type { InternalGerstnerParams } from "../../shaders/gerstner";
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
    /** Get the displacement storage buffer for a cascade. Returns null on WebGL (uses textures). */
    getDisplacementBuffer(cascadeIndex?: number): TSLBuffer | null;
    /** Get the normal storage buffer for a cascade. Returns null on WebGL (uses textures). */
    getNormalBuffer(cascadeIndex?: number): TSLBuffer | null;
    /**
     * Get the normal texture for a cascade. Available on both backends:
     * WebGL renders normals to a texture target; WebGPU writes a StorageTexture
     * mirror of its normal storage buffer in `computeNormals`. Fragment-side
     * consumers (cascade sampler, caustics, sun shafts) sample this with
     * hardware bilinear.
     */
    getNormalTexture(cascadeIndex?: number): THREE.Texture | null;
    /** Get the resolution for a cascade. */
    getResolution(cascadeIndex?: number): number;
    /** Get the world-space scale for a cascade. */
    getScale(cascadeIndex?: number): number;
    /** Update cascade configuration (scale, amplitude). */
    updateCascadeConfig(index: number, config: CascadeConfig): void;
    /** Get the Gerstner wave buffer node (uniformArray), or null if Gerstner disabled */
    getGerstnerWaveBuffer(): Node | null;
    /** Get the Gerstner wave count uniform node, or null if Gerstner disabled */
    getGerstnerWaveCountUniform(): Node | null;
    /** Get the compile-time max waves (determines shader loop bound) */
    getGerstnerMaxWaves(): number;
    /** Get the time uniform node for Gerstner evaluation */
    getTimeUniform(): Node | null;
    /** Update Gerstner wave parameters (auto-distributes waves from center wavelength) */
    updateGerstnerParams(params: InternalGerstnerParams): void;
    /** Get Gerstner wave state for CPU-side evaluation */
    getGerstnerCPUState(): {
        waveData: THREE.Vector4[] | null;
        waveCount: number;
        time: number;
    };
}
//# sourceMappingURL=IWaveSimulation.d.ts.map