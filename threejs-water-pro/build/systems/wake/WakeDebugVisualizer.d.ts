import * as THREE from "three/webgpu";
import type { WakeDebugConfig, WakeDebugData } from "./index";
/**
 * Renders debug indicators for wake generators. For each generator it draws:
 *
 * - a marker sphere at the injection point, and
 * - a wireframe cylinder whose XZ radius is the footprint `radius` and whose
 *   height is the hull push-down `depth`, hanging from the waterline.
 *
 * The cylinder's top cap ring is the footprint disk; its height is how far the
 * hull pushes the water down — the two parameters read off as orthogonal axes.
 *
 * Active generators draw in the active colour, inactive ones dimmed. Mirrors
 * {@link BuoyancyDebugVisualizer}: pooled helpers driven each frame by
 * {@link WakeSystem.getDebugData}. The cylinder is a unit primitive scaled per
 * generator, so radius/depth changes show without rebuilding geometry.
 */
export declare class WakeDebugVisualizer {
    private scene;
    private config;
    private container;
    private enabled;
    private sphereGeometry;
    private cylinderGeometry;
    private activeMaterial;
    private inactiveMaterial;
    private activeLineMaterial;
    private inactiveLineMaterial;
    private pool;
    constructor(scene: THREE.Scene, config?: Partial<WakeDebugConfig>);
    /** Enable or disable the debug visualization. */
    setEnabled(enabled: boolean): void;
    /** Whether the visualization is currently enabled. */
    isEnabled(): boolean;
    /**
     * Update the indicators from the current generator snapshot.
     *
     * @param debugData - Per-generator data from {@link WakeSystem.getDebugData}.
     */
    update(debugData: WakeDebugData[]): void;
    /** Get an indicator from the pool, creating it if necessary. */
    private getIndicator;
    /**
     * Build a unit wireframe cylinder for a generator footprint: a cap ring at the
     * waterline (y = 0) and one at unit depth (y = −1), joined by vertical struts.
     * Radius 1 in XZ; scaling (radius, depth, radius) maps it to the generator's
     * footprint and push-down depth.
     */
    private buildCylinderGeometry;
    /** Dispose of all GPU resources and detach from the scene. */
    dispose(): void;
}
//# sourceMappingURL=WakeDebugVisualizer.d.ts.map