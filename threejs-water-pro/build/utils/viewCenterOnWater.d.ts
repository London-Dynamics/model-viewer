import * as THREE from "three/webgpu";
/**
 * World-space point a camera-anchored field centres on: where the camera's
 * centre view ray meets the water plane (`y = 0`), clamped so the centre can't
 * outrun the camera across the horizon. Shared by the wake and wave-crest foam
 * fields so their anchoring stays identical.
 *
 * Falls back to the camera's XZ when looking up or nearly horizontal (the ray
 * never meets the plane in front of the camera).
 *
 * @param camera - The camera the field follows.
 * @param halfExtent - Half the field's world width; the clamp half-range.
 * @param forward - Scratch vector, overwritten with the camera forward (reused
 *   to avoid a per-call allocation).
 * @returns The anchor's world X/Z.
 */
export declare function viewCenterOnWater(camera: THREE.Camera, halfExtent: number, forward: THREE.Vector3): {
    x: number;
    z: number;
};
//# sourceMappingURL=viewCenterOnWater.d.ts.map