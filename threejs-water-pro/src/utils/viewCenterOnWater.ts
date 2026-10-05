// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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
export function viewCenterOnWater(
  camera: THREE.Camera,
  halfExtent: number,
  forward: THREE.Vector3,
): { x: number; z: number } {
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);

  if (forward.y >= -0.01) {
    return { x: camera.position.x, z: camera.position.z };
  }

  const t = -camera.position.y / forward.y;
  const hitX = camera.position.x + forward.x * t;
  const hitZ = camera.position.z + forward.z * t;

  const dx = hitX - camera.position.x;
  const dz = hitZ - camera.position.z;
  const clampedX =
    camera.position.x + Math.max(-halfExtent, Math.min(halfExtent, dx));
  const clampedZ =
    camera.position.z + Math.max(-halfExtent, Math.min(halfExtent, dz));

  return { x: clampedX, z: clampedZ };
}
