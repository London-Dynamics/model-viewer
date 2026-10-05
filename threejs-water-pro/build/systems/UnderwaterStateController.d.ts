/**
 * Underwater state controller.
 *
 * Owns the two pieces of "what's happening with the water surface right
 * now" state that several subsystems care about:
 *
 * 1. **Underwater rendering enabled** — a static config flag sourced from
 *    `Underwater.enabled`. Toggling it switches on / off the waterline
 *    meniscus, ocean-floor visibility resolution, and the render-pass
 *    manager's underwater branch.
 *
 * 2. **Camera submerged** — derived each frame from
 *    `BuoyancySystem.getCameraWaterHeight()` and the camera's Y position.
 *    Read by other subsystems (e.g. sun shafts) via the `cameraSubmerged`
 *    getter. The underwater post-pass classifies fog per pixel from the
 *    depth channels alone and does not consume this flag.
 */
import type * as THREE from "three/webgpu";
import type { BuoyancySystem } from "./buoyancy";
import type { Underwater } from "../rendering/postprocessing";
import type { UnderwaterParticles } from "./underwater";
import type { WaterSurfaceMaterial } from "../components/surface/WaterSurfaceMaterial";
import type { Waterline } from "../shaders/waterline";
import type { OceanFloor } from "../components/floor/OceanFloor";
import type { WaterSubsystem } from "./types";
/**
 * Fixed set of consumers the controller writes to. The constructor takes
 * them as one object so adding a new consumer is a one-field change and
 * the wire-up site in `WaterSystem.create` stays compact.
 */
export interface UnderwaterStateRefs {
    /** Source of the cameraWaterHeight readback driving submersion detection. */
    buoyancy: BuoyancySystem;
    /** Authority on `underwaterEnabled`. */
    underwater: Underwater;
    /** Particles advanced/spawned by the per-frame update. */
    particles: UnderwaterParticles;
    /** Surface material — consumed for waterline meniscus enable/disable wiring. */
    material: WaterSurfaceMaterial;
    /** Waterline meniscus — only meaningful when underwater rendering is enabled. */
    waterline: Waterline;
    /** Floor visibility flips off when underwater rendering is disabled. */
    oceanFloor: OceanFloor;
}
export declare class UnderwaterStateController implements WaterSubsystem {
    private readonly _refs;
    private _camera;
    private _cameraSubmerged;
    constructor(camera: THREE.PerspectiveCamera, refs: UnderwaterStateRefs);
    /** Reassign the camera (called from `WaterSystem.set camera`). */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Repoint refs after a quality-level switch. `setQualityLevel`
     * recreates the surface material and the underwater particle pool;
     * the other refs (buoyancy, underwater, waterline, ocean floor, RPM)
     * survive untouched.
     */
    rebind(refs: {
        material: WaterSurfaceMaterial;
        particles: UnderwaterParticles;
    }): void;
    /**
     * Whether the camera is currently below the water surface. Computed
     * from the buoyancy sampler's last camera-water-height readback against
     * the camera's world-space Y. Stays `false` when underwater rendering
     * is disabled — there is no submersion semantics outside the underwater
     * branch.
     */
    get cameraSubmerged(): boolean;
    /** Mirrors the authoritative `Underwater.enabled` flag. */
    get underwaterEnabled(): boolean;
    /**
     * Per-substep tick. Propagates the `enabled` flag to all consumers,
     * recomputes `cameraSubmerged` when enabled, and resets it to `false`
     * when disabled so app-level consumers see the right value after a
     * toggle-off.
     */
    step(deltaTime: number, gpuTime: number): void;
}
//# sourceMappingURL=UnderwaterStateController.d.ts.map