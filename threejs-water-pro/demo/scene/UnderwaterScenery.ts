// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type * as THREE from "three/webgpu";
import type { LoadedModels } from "./ModelLoader";
import type { FishManager } from "./FishManager";

/**
 * The underwater content cluster — fish, grass, rocks, seaweed. Owns their
 * shared visibility (the underwater checkbox in Controls.ts hides the whole
 * cluster when the camera surfaces) and their vertical placement, which
 * follows the ocean floor.
 */
export class UnderwaterScenery {
  constructor(
    private readonly _models: LoadedModels,
    private readonly _fish: FishManager,
  ) {}

  setVisible(visible: boolean): void {
    this._fish.setVisible(visible);
    for (const mesh of this.floorMeshes()) {
      mesh.visible = visible;
    }
  }

  /**
   * Moves the cluster to sit on an ocean floor `depth` metres below the
   * surface. Props and fish are authored relative to the floor.
   */
  setFloorDepth(depth: number): void {
    this._fish.setFloorDepth(depth);
    for (const mesh of this.floorMeshes()) {
      mesh.position.y = -depth;
    }
  }

  private floorMeshes(): THREE.InstancedMesh[] {
    const { grass, rocks, seaweed } = this._models.oceanFloorObjects;
    return [...grass, ...rocks, ...seaweed];
  }
}
