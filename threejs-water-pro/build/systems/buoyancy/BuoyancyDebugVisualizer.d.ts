import * as THREE from "three/webgpu";
import type { BuoyancyDebugData, BuoyancyDebugConfig } from "./types";
/**
 * BuoyancyDebugVisualizer renders debug visualizations for the buoyancy system.
 *
 * Shows:
 * - Spheres at each sample point (center, bow, stern, port, starboard)
 * - Arrows indicating surface normals at each point
 * - Different colors for center vs. other sample points
 */
export declare class BuoyancyDebugVisualizer {
    private scene;
    private config;
    private container;
    private enabled;
    private sphereGeometry;
    private centerMaterial;
    private pointMaterial;
    private markerPool;
    private arrowPool;
    private activeMarkerCount;
    private activeArrowCount;
    constructor(scene: THREE.Scene, config?: Partial<BuoyancyDebugConfig>);
    /**
     * Enable or disable the debug visualization
     */
    setEnabled(enabled: boolean): void;
    /**
     * Update the scale of debug markers and arrows
     * @param scale Scale factor (1.0 = default size)
     */
    setScale(scale: number): void;
    /**
     * Check if visualization is enabled
     */
    isEnabled(): boolean;
    /**
     * Update the debug visualization with current sample data
     * @param debugData Array of debug data for each buoyant object
     */
    update(debugData: BuoyancyDebugData[]): void;
    /**
     * Get a marker from the pool, creating if necessary
     */
    private getMarker;
    /**
     * Get an arrow from the pool, creating if necessary
     */
    private getArrow;
    /**
     * Hide all helpers
     */
    private hideAllHelpers;
    /**
     * Dispose of all resources
     */
    dispose(): void;
}
//# sourceMappingURL=BuoyancyDebugVisualizer.d.ts.map