import * as THREE from "three/webgpu";
export interface ClipmapConfig {
    levels: number;
    segments: number;
    baseSize: number;
    /**
     * World-space outer extent of the flat "infinity" ring that bridges the
     * outermost LOD to the horizon. Computed as `camera.far * 0.95` by
     * WaterSystem so the ring stays inside the camera frustum — setting this
     * directly is only appropriate when constructing WaterSurfaceGeometry
     * without a full WaterSystem.
     */
    infinityRingExtent: number;
}
/**
 * Traditional geometry clipmap for infinite terrain/water rendering.
 *
 * Each level is a uniform square grid where:
 * - Level 0 has size `baseSize` with vertex spacing `baseSize / segments`
 * - Level N has size `baseSize * 2^N` with vertex spacing `baseSize * 2^N / segments`
 *
 * Grid snapping prevents "swimming" artifacts by ensuring vertices stay
 * fixed relative to the wave field. Each level snaps to its own grid,
 * and the grids are hierarchically aligned (level N+1 grid points are
 * a subset of level N grid points).
 *
 * @see https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry
 * @see https://mikejsavage.co.uk/geometry-clipmaps/
 */
/**
 * Fired after every {@link WaterSurfaceGeometry.update} with the latest
 * grid-snapped centre position in world space. Consumers that need to
 * follow the clipmap (water material offset uniform, ocean floor mesh
 * position) subscribe instead of being poked by `WaterSystem`.
 */
export type SnappedPositionListener = (x: number, z: number) => void;
export declare class WaterSurfaceGeometry {
    private static readonly UNDERWATER_DEPTH;
    private config;
    private container;
    private snappedPosition;
    private surfaceMesh;
    private underwaterMesh;
    private underwaterMaterial;
    private _snappedPositionListeners;
    constructor(config: ClipmapConfig, material: THREE.Material);
    private createLevels;
    /**
     * Collect geometries to enclose the underwater volume:
     * - A ground plane at -UNDERWATER_DEPTH
     * - Vertical skirts on all 4 outer edges extending past the ground plane
     *
     * The volume is sized to the outermost LOD regardless of whether the flat
     * infinity ring is enabled: downstream systems (underwater fog, depth
     * readback, masking) depend on the "curtain" sitting at a predictable
     * world-space distance from the camera, and growing it with the infinity
     * ring would push it far enough that fog saturates before reaching it.
     */
    private collectUnderwaterGeometries;
    /**
     * Create a vertical skirt geometry on one edge of the clipmap.
     * Top edge vertices match the outermost clipmap level's edge exactly.
     * Normals face inward (back-facing when viewed from inside the volume).
     */
    private createEdgeSkirtGeometry;
    /**
     * Create transition strip geometry that connects level N's outer edge to level N+1's interior.
     * The strip has fine spacing on its inner edge (matching level N) and coarse spacing on its
     * outer edge (matching level N+1's interior grid).
     *
     * This handles T-junctions where 2 fine vertices connect to 1 coarse vertex.
     */
    private createSkirtGeometry;
    /**
     * Create ring geometry (square with square hole) using uniform vertex spacing.
     * All vertices lie on a regular grid aligned with the spacing.
     */
    private createRingGeometry;
    /**
     * Build the flat "infinity" ring — a square ring whose inner edge is
     * coincident with the outermost LOD's outer edge and whose outer edge
     * reaches to `outerSize`.
     *
     * The inner edge is tessellated at `innerSpacing` so its vertex positions
     * line up one-for-one with the outermost LOD's outer-edge vertices. This
     * eliminates the T-junction gap that would otherwise appear where the
     * fine outer LOD meets a coarse ring on a shared seam. Each inner vertex
     * gets a radially-projected partner on the outer boundary (scaled by
     * outer/inner so ring corners map to corners), producing a uniform strip
     * of quads per side.
     */
    private createInfinityRingGeometry;
    /**
     * Get the world size of a clipmap level.
     * Each level is 2x the size of the previous level.
     */
    getLevelSize(level: number): number;
    /**
     * Get the vertex spacing for a clipmap level.
     * Each level has 2x the spacing of the previous level.
     */
    getLevelVertexSpacing(level: number): number;
    /**
     * Update clipmap position with hierarchical grid snapping.
     *
     * Each level snaps to its own grid (multiples of its vertex spacing).
     * This prevents vertices from "swimming" as the camera moves.
     *
     * For simplicity, we snap all levels to the finest (level 0) grid.
     * Since each coarser level's grid is a subset of the finer grid,
     * this ensures all levels stay aligned.
     */
    update(cameraPosition: THREE.Vector3): void;
    /**
     * Get the current snapped position of the clipmap.
     */
    getSnappedPosition(): THREE.Vector2;
    /**
     * Register a callback that fires after every {@link update} with the
     * latest grid-snapped centre. Use this to keep follower objects (water
     * material offset, ocean floor mesh) in sync without poking them from
     * `WaterSystem`.
     */
    addSnappedPositionListener(fn: SnappedPositionListener): void;
    /**
     * Get the vertex spacing for the finest (innermost) level.
     */
    getVertexSpacing(): number;
    /**
     * Get the Three.js group containing all clipmap meshes.
     */
    getObject(): THREE.Group;
    /**
     * Rebuild the clipmap with new configuration.
     * Disposes existing geometry and creates new levels.
     */
    rebuild(config: Partial<ClipmapConfig>, material: THREE.Material): void;
    /**
     * Get the current clipmap configuration.
     */
    getConfig(): Readonly<ClipmapConfig>;
    /**
     * Dispose of all geometry and materials.
     * @param full - When true, also disposes the underwater material.
     *   Pass false (or omit) when the object will be reused (e.g., rebuild).
     */
    dispose(full?: boolean): void;
    /**
     * Get total vertex count of the merged geometry.
     */
    getVertexCount(): number;
    /**
     * Get the outermost size of the clipmap.
     */
    getTotalSize(): number;
    /**
     * Get number of levels.
     */
    getLevelCount(): number;
    /**
     * Set the material for the water surface mesh.
     */
    setMaterial(material: THREE.Material): void;
}
//# sourceMappingURL=WaterSurfaceGeometry.d.ts.map