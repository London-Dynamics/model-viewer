import {Material, Mesh, Object3D} from 'three';

import {isInnerWallPart} from './surface-snapping.js';

export type InnerWallMode = 'solid' | 'transparent' | 'hidden';

const GLASS_OPACITY = 0.2;

/** `solid` for any value other than `transparent` or `hidden`. */
export function normalizeInnerWallMode(
  value: string | null | undefined
): InnerWallMode {
  if (value === 'transparent' || value === 'hidden') return value;
  return 'solid';
}

/**
 * Swaps inner-wall meshes between authored materials, one shared glass clone
 * per source material, and hidden. No camera test and no per-frame work.
 * Perimeter meshes are never visited.
 */
export class InnerWallModeState {
  private originals = new Map<Mesh, Material | Material[]>();
  private clones = new Map<string, Material>();

  apply(root: Object3D, mode: InnerWallMode): void {
    const meshes = this.parts(root);
    if (mode === 'transparent') {
      for (const mesh of meshes) {
        if (!this.originals.has(mesh)) this.originals.set(mesh, mesh.material);
        mesh.visible = true;
        mesh.material = this.glass(this.originals.get(mesh)!);
      }
      return;
    }
    for (const mesh of meshes) {
      const authored = this.originals.get(mesh);
      if (authored) mesh.material = authored;
      mesh.visible = mode === 'solid';
    }
    this.originals.clear();
    this.disposeClones();
  }

  /** Drop bookkeeping when the room mesh is going away. */
  reset(): void {
    this.originals.clear();
    this.disposeClones();
  }

  private parts(root: Object3D): Mesh[] {
    const meshes: Mesh[] = [];
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh && isInnerWallPart(mesh.name)) meshes.push(mesh);
    });
    return meshes;
  }

  private glass(source: Material | Material[]): Material | Material[] {
    if (Array.isArray(source)) return source.map((material) => this.clone(material));
    return this.clone(source);
  }

  private clone(source: Material): Material {
    let clone = this.clones.get(source.uuid);
    if (!clone) {
      clone = source.clone();
      clone.transparent = true;
      clone.opacity = GLASS_OPACITY;
      clone.depthWrite = false;
      this.clones.set(source.uuid, clone);
    }
    return clone;
  }

  private disposeClones(): void {
    for (const clone of this.clones.values()) clone.dispose();
    this.clones.clear();
  }
}
