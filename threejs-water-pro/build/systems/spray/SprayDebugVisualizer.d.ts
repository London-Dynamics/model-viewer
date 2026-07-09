/**
 * Spray probe debug visualizer.
 *
 * For each registered probe, renders:
 *   - A wireframe sphere at the probe's world position. Sphere size is a
 *     fixed visualization constant (`config.sphereRadius`) — probes
 *     themselves don't carry a radius. Colour reflects the probe's
 *     lifecycle state:
 *         grey    — `disabled`   (probe's `enabled` flag is off)
 *         blue    — `inactive`   (not eligible to fire this frame)
 *         green   — `playing`    (a billboard's flipbook is on screen)
 *         yellow  — `respawning` (waiting for the cooldown to expire)
 *   - An arrow along the probe's instantaneous world velocity (rigid-body
 *     linear + angular). Length scales with speed; reads at a glance how
 *     fast each probe is moving relative to the world. Probes with
 *     near-zero velocity collapse to a stub. Note that the emission gate
 *     fires on probe-vs-surface convergence rate (impact speed), not
 *     probe speed, so a stationary probe can still fire when a wave
 *     rises onto it.
 *
 * Pool-based: meshes are reused frame-to-frame, only updated. Per-frame
 * cost is small even with many probes; debug-only.
 *
 * Mirrors the `BuoyancyDebugVisualizer` pattern. Owned by the demo (or any
 * external caller); the spray library exposes `getProbeDebugData()` and
 * the visualizer renders the snapshot.
 */
import * as THREE from "three/webgpu";
import type { ProbeDebugSnapshot } from "./EmitterRegistry";
export interface SprayDebugConfig {
    /** Arrow length (m) per 1 m/s of probe speed. Default `0.3`. */
    arrowLengthPerSpeed: number;
    /**
     * Maximum arrow length (m). Caps the velocity-driven length so arrows
     * stay readable on probes moving at extreme speeds. Default `12.0`.
     */
    arrowMaxLength: number;
    /** Colour when probe's `enabled` flag is off. */
    disabledColor: number;
    /** Colour when probe is inactive (not firing). */
    inactiveColor: number;
    /** Colour when a billboard's flipbook is currently playing. */
    playingColor: number;
    /** Colour when probe is in the respawn cooldown. */
    respawningColor: number;
    /** Wireframe sphere radius (m). Visualization-only constant. Default `0.6`. */
    sphereRadius: number;
    /** Sphere wireframe segment count (low = ugly, high = expensive). Default 8. */
    sphereSegments: number;
}
export declare class SprayDebugVisualizer {
    private _scene;
    private _config;
    private _container;
    private _enabled;
    private _spherePool;
    private _arrowPool;
    private _activeCount;
    private _sphereGeometry;
    private _stateMaterials;
    private _stateColors;
    constructor(scene: THREE.Scene, config?: Partial<SprayDebugConfig>);
    /** Whether the debug visualization is enabled. */
    isEnabled(): boolean;
    /** Enable or disable the visualization. */
    setEnabled(enabled: boolean): void;
    /**
     * Push a fresh snapshot of probe states into the visualizer. Typically
     * called once per frame from the demo's render loop with
     * `water.spray.getProbeDebugData()`.
     */
    update(snapshots: ProbeDebugSnapshot[]): void;
    /** Free GPU resources. */
    dispose(): void;
    private _hideAll;
}
//# sourceMappingURL=SprayDebugVisualizer.d.ts.map