import * as THREE from "three/webgpu";
import { Caustics } from "../../shaders/caustics";
import type { TSLBuffer } from "../../types/tsl";
import type { OceanFloorOptions } from "./types";
import type { IWaveSimulation } from "../../simulation/waves";
export type { OceanFloorOptions };
export declare class OceanFloor {
    private mesh;
    private material;
    private geometry;
    private sandTextures;
    private rockyTextures;
    private options;
    private _userVisible;
    readonly caustics: Caustics;
    private displacementUniforms;
    private constructor();
    /**
     * Create and initialize an OceanFloor instance.
     *
     * @param options - Configuration options (flat structure)
     * @returns Promise resolving to the initialized OceanFloor
     */
    static create(options: OceanFloorOptions): Promise<OceanFloor>;
    /**
     * Initialize uniforms from options.
     */
    private initializeUniforms;
    /**
     * Calculate terrain displacement height at a given world position.
     * Uses inverted scale so larger values = larger features.
     */
    private calculateTerrainHeight;
    /**
     * Calculate UV coordinates for texture sampling based on world position.
     */
    private calculateUV;
    /**
     * Calculate raw FBM noise value (before strength scaling) for blend factor.
     * Returns value in approximately [-1, 1] range.
     */
    private calculateRawTerrainNoise;
    /**
     * Calculate blend factor between sand (0) and rocky (1) based on terrain height.
     * Uses smoothstep for soft transition around threshold.
     */
    private calculateBlendFactor;
    /**
     * Apply material with textures and per-vertex terrain displacement/normals.
     * Blends between sand and rocky textures based on terrain height.
     */
    private applyMaterial;
    /** Get the Three.js mesh object */
    getMesh(): THREE.Mesh;
    /**
     * Position the floor to follow the camera, snapped to the floor's own
     * vertex grid.
     *
     * Terrain height, sand/rock blend, and normals are sampled per-vertex from
     * world-space noise. For that world-locked pattern to stay fixed while the
     * mesh moves, the floor must shift in whole-cell steps so its vertices
     * always land on the same world lattice. Snapping to the floor's own cell
     * size — rather than reusing the clipmap's coarser snap grid — keeps the
     * terrain stable at any mesh resolution. Reusing the clipmap grid only
     * stays stable when `meshResolution` is an integer multiple of the clipmap
     * segment count; otherwise each move lands the vertices mid-cell and the
     * terrain visibly pops.
     */
    setFollowPosition(x: number, z: number): void;
    /** Update the ocean floor (call once per frame) */
    update(_time: number): void;
    /** Set the depth (Y position) of the ocean floor */
    setDepth(depth: number): void;
    /** Get the current depth of the ocean floor */
    getDepth(): number;
    /** Set visibility of the ocean floor */
    setVisible(visible: boolean): void;
    /** Check if ocean floor is visible */
    isVisible(): boolean;
    /** @internal Resolve effective visibility from user setting and underwater state */
    resolveVisibility(underwaterEnabled: boolean): void;
    /**
     * Update displacement configuration.
     * Call this when UI params change to sync uniforms.
     */
    updateDisplacementConfig(config: Partial<OceanFloorOptions>): void;
    /**
     * Update caustics configuration.
     * Call this when UI params change to sync uniforms.
     */
    updateCausticsConfig(config: OceanFloorOptions["caustics"]): void;
    /**
     * Set wave buffer references for wave-based caustics (WebGPU).
     * Must be called before the material is first rendered to take effect.
     */
    setWaveBuffers(options: {
        normalBuffer: TSLBuffer;
        resolution: number;
        scale: number;
    }): void;
    /**
     * Set wave texture reference for wave-based caustics (WebGL).
     * Must be called before the material is first rendered to take effect.
     */
    setWaveTexture(options: {
        normalTexture: THREE.Texture;
        resolution: number;
        scale: number;
    }): void;
    /**
     * Updates buffer resolution and scale at runtime.
     *
     * @param resolution - Resolution in texels.
     * @param scale - World-space scale in units.
     */
    updateBufferParams(resolution: number, scale: number): void;
    /**
     * Rebind to the wave simulation. Pulls cascade-0 normal texture,
     * resolution, and scale — the inputs the caustics shader consumes to
     * modulate the procedural caustic pattern with the live wave surface.
     * Called whenever cascade configuration changes or the wave sim is
     * recreated.
     */
    onCascadeChanged(sim: IWaveSimulation): void;
    /** Dispose of all resources */
    dispose(): void;
}
//# sourceMappingURL=OceanFloor.d.ts.map