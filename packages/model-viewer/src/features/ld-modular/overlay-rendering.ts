import {Material, Mesh, Object3D} from 'three';

/** Base render order for overlay meshes (cursor fill, paste ghost). */
export const OVERLAY_RENDER_ORDER = 9999;

/** Cursor ring sits above ghosts when both are visible. */
export const OVERLAY_RENDER_ORDER_TOP = OVERLAY_RENDER_ORDER + 1;

export const PASTE_GHOST_OPACITY = 0.35;

export type OverlayRenderingOptions = {
  opacity?: number;
  renderOrder?: number;
};

/**
 * Three.js mesh.clone() shares material references. Clone materials so overlay
 * or paste operations never mutate the source object's appearance.
 */
export function cloneMeshMaterials(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) =>
        material?.clone ? material.clone() : material
      );
    } else if (mesh.material.clone) {
      mesh.material = mesh.material.clone();
    }
  });
}

/** Reset mesh render state after paste commit (materials are fresh clones). */
export function restoreCommittedMeshRendering(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 0;
    mesh.frustumCulled = true;
    delete mesh.userData.noHit;
  });
}

/**
 * Renders an object on top of scene geometry (depth test off), matching the
 * placement cursor technique.
 */
export function applyOverlayRendering(
  root: Object3D,
  options: OverlayRenderingOptions = {}
): void {
  const opacity = options.opacity ?? PASTE_GHOST_OPACITY;
  const renderOrder = options.renderOrder ?? OVERLAY_RENDER_ORDER;

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;

    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.userData.noHit = true;
    mesh.userData.selectable = false;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      applyOverlayMaterial(material, opacity);
    }
  });
}

function applyOverlayMaterial(material: Material, opacity: number): void {
  material.transparent = true;
  material.opacity = opacity;
  material.depthTest = false;
  material.depthWrite = false;
  material.needsUpdate = true;
}

export function markPasteGhostNonInteractive(ghost: Object3D): void {
  ghost.userData.isPasteGhost = true;
  ghost.traverse((child) => {
    child.userData.isPasteGhost = true;
    child.userData.noHit = true;
    child.userData.selectable = false;
  });
}
