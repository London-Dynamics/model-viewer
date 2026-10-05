// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";

export interface SprayProbe {
  local: THREE.Vector3;
}

export interface WakeOffsets {
  /** World-metre offset from the ship origin to the bow (forward). */
  bow: THREE.Vector3;
  /** World-metre offset from the ship origin to the stern (aft). */
  stern: THREE.Vector3;
}

export interface BuoyancySampling {
  /** Bow-to-stern span of the sample box, in world metres. */
  sampleLength: number;
  /** Port-to-starboard span of the sample box, in world metres. */
  sampleWidth: number;
  /** World-metre offset from the ship origin to the sample-box centre. */
  sampleOffset: THREE.Vector3;
}

/**
 * Ship-local bounding box, computed with the transform temporarily zeroed so
 * it's expressed in pre-scale local space and is independent of the GLB's
 * origin, scale, and heading. Forward = +Z (see ShipController.updatePosition).
 *
 * Shared by {@link computeSprayProbes} (which wants pre-scale local coords) and
 * {@link computeWakeOffsets} (which scales them up to world metres).
 */
function localHullBounds(ship: THREE.Object3D): THREE.Box3 {
  const savedPos = ship.position.clone();
  const savedQuat = ship.quaternion.clone();
  const savedScale = ship.scale.clone();
  ship.position.set(0, 0, 0);
  ship.quaternion.identity();
  ship.scale.set(1, 1, 1);
  ship.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(ship);
  ship.position.copy(savedPos);
  ship.quaternion.copy(savedQuat);
  ship.scale.copy(savedScale);
  ship.updateMatrixWorld(true);
  return bbox;
}

/**
 * Place spray probes proportionally to the ship's local-space bounding box,
 * so coordinates aren't tied to the GLB's specific origin or scale. The spray
 * system applies the ship's full transform (including scale) to each `local`.
 */
export function computeSprayProbes(ship: THREE.Object3D): SprayProbe[] {
  const bbox = localHullBounds(ship);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const halfLen = size.z * 0.5;
  const halfBeam = size.x * 0.5;
  const waterlineY = bbox.min.y; // probe along the keel-line

  const at = (offX: number, offY: number, offZ: number): THREE.Vector3 =>
    new THREE.Vector3(
      center.x + offX * halfBeam,
      waterlineY + offY * size.y,
      center.z + offZ * halfLen,
    );

  return [
    { local: at(0, 0.1, 0.5) },
    { local: at(0, 0.1, -0.9) },
    { local: at(0.6, 0.1, 0.3) },
    { local: at(-0.6, 0.1, 0.3) },
    { local: at(0.75, 0.1, 0.1) },
    { local: at(-0.75, 0.1, 0.1) },
    { local: at(0.8, 0.1, -0.1) },
    { local: at(-0.8, 0.1, -0.1) },
    { local: at(0.8, 0.1, -0.3) },
    { local: at(-0.8, 0.1, -0.3) },
    { local: at(0.75, 0.1, -0.5) },
    { local: at(-0.75, 0.1, -0.5) },
    { local: at(0.6, 0.1, -0.7) },
    { local: at(-0.6, 0.1, -0.7) },
  ];
}

/**
 * Multi-point buoyancy sampling box for the ship, in world metres. Mirrors the
 * library's bounding-box auto-derivation (`BuoyancySystem.addObject`) but pulls
 * the bow and stern sample points inboard of the bounding-box tips so they sit
 * on the waterline hull. The two insets are independent because the AABB is
 * asymmetric: the bowsprit juts far forward (+Z), so the bow needs a much
 * larger inset than the overhang-free stern. Pass with `useBoundingBox: false`.
 *
 * @param insets - World-metre inset for each end from its bounding-box tip.
 */
export function computeBuoyancySampling(
  ship: THREE.Object3D,
  insets: { bow: number; stern: number },
): BuoyancySampling {
  const bbox = localHullBounds(ship);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  // localHullBounds is pre-scale; sample geometry is world metres. +Z is the
  // bow (bowsprit) end, −Z the stern (see the hull-frame convention above).
  const halfLength = size.z * 0.5 * ship.scale.z;
  const aabbCenterZ = center.z * ship.scale.z;
  const bowZ = aabbCenterZ + halfLength - insets.bow;
  const sternZ = aabbCenterZ - halfLength + insets.stern;
  return {
    sampleLength: Math.max(1, bowZ - sternZ),
    sampleWidth: size.x * ship.scale.x * 0.8,
    sampleOffset: new THREE.Vector3(
      center.x * ship.scale.x,
      0,
      (bowZ + sternZ) * 0.5,
    ),
  };
}
