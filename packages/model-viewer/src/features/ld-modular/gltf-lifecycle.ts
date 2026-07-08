/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import type {Material, Mesh, Object3D} from 'three';

/**
 * Source URL for a placed / placeholder GLTF root. Used for retain bookkeeping
 * and later same-URL scene cloning.
 */
export const LD_GLTF_SRC = 'ldGltfSrc';

const releaseByRoot = new WeakMap<Object3D, () => void>();

/**
 * Bind loader cache release to a scene root acquired via CachingGLTFLoader.load.
 * Call `releaseGltfLifecycle` only when the root is permanently discarded
 * (graveyard prune / clear, placeholder cleanup) — not when merely detached
 * for undo.
 */
export function attachGltfLifecycle(
  root: Object3D,
  src: string,
  release: () => void
): void {
  releaseByRoot.set(root, release);
  try {
    root.userData[LD_GLTF_SRC] = src;
  } catch (e) {
    // ignore userData write failures
  }
}

export function releaseGltfLifecycle(
  root: Object3D | null | undefined
): void {
  if (!root) return;
  const release = releaseByRoot.get(root);
  if (!release) return;
  releaseByRoot.delete(root);
  try {
    release();
  } catch (e) {
    // ignore release failures
  }
}

export function hasGltfLifecycle(root: Object3D | null | undefined): boolean {
  return !!root && releaseByRoot.has(root);
}

/**
 * Tear down per-instance GPU resources for a permanently discarded subtree.
 * Geometry buffers are shared across SkeletonUtils / Object3D clones of the
 * same URL — never dispose them here (same policy as clipboard dispose).
 * Material.dispose() does not dispose textures.
 */
export function disposePlacedObjectSubtree(root: Object3D): void {
  const disposedMaterials = new Set<Material>();
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      try {
        material.dispose?.();
      } catch (e) {
        // ignore
      }
    }
  });
}
