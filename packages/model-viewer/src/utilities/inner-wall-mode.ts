import {Material, Mesh, Object3D} from 'three';

import {isInnerWallCutaway, isInnerWallPart} from './surface-snapping.js';

export type InnerWallMode = 'solid'|'transparent'|'hidden'|'cutaway';

const GLASS_OPACITY = 0.2;

/** `solid` for any value other than `transparent`, `hidden`, or `cutaway`. */
export function normalizeInnerWallMode(value: string|null|
                                       undefined): InnerWallMode {
  if (value === 'transparent' || value === 'hidden' || value === 'cutaway') {
    return value;
  }
  return 'solid';
}

/**
 * A placed object snapped to a full-height inner wall. Perimeter `wall_*`
 * attachments and floor attachments are not included.
 */
export function isAttachedToInnerWall(
    userData: {attachedWallName?: unknown; attachedSurfaceName?: unknown;}|
    undefined): boolean {
  const wallName = typeof userData?.attachedWallName === 'string' ?
      userData.attachedWallName :
      undefined;
  const surfaceName = typeof userData?.attachedSurfaceName === 'string' ?
      userData.attachedSurfaceName :
      undefined;
  return isInnerWallPart(wallName) || isInnerWallPart(surfaceName);
}

/**
 * Swaps inner-wall meshes between authored materials, one shared glass clone
 * per source material, and hidden. No camera test and no per-frame work.
 * Perimeter meshes are never visited.
 */
export class InnerWallModeState {
  private originals = new Map<Mesh, Material|Material[]>();
  private clones = new Map<string, Material>();
  private root: Object3D|null = null;

  apply(root: Object3D, mode: InnerWallMode): void {
    if (this.root !== root) {
      this.originals.clear();
      this.disposeClones();
      this.root = root;
    }
    const full = this.parts(root, isInnerWallPart);
    const cutaway = this.parts(root, isInnerWallCutaway);
    if (mode === 'transparent') {
      for (const mesh of cutaway)
        mesh.visible = false;
      for (const mesh of full) {
        if (!this.originals.has(mesh))
          this.originals.set(mesh, mesh.material);
        mesh.visible = true;
        mesh.material = this.glass(this.originals.get(mesh)!);
      }
      return;
    }
    for (const mesh of full) {
      const authored = this.originals.get(mesh);
      if (authored)
        mesh.material = authored;
      mesh.visible = mode === 'solid';
    }
    for (const mesh of cutaway)
      mesh.visible = mode === 'cutaway';
    this.originals.clear();
    this.disposeClones();
  }

  /** Drop bookkeeping when the room mesh is going away. */
  reset(): void {
    this.root = null;
    this.originals.clear();
    this.disposeClones();
  }

  private parts(root: Object3D, match: (name: string|undefined) => boolean):
      Mesh[] {
    const meshes: Mesh[] = [];
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh && match(mesh.name))
        meshes.push(mesh);
    });
    return meshes;
  }

  private glass(source: Material|Material[]): Material|Material[] {
    if (Array.isArray(source))
      return source.map((material) => this.clone(material));
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
    for (const clone of this.clones.values())
      clone.dispose();
    this.clones.clear();
  }
}
