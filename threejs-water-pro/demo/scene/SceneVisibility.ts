import type { LoadedModels } from "./ModelLoader";
import type { FishManager } from "./FishManager";

/**
 * Toggles for the "underwater" content cluster — fish, grass, rocks,
 * seaweed. The underwater checkbox in Controls.ts hides everything in
 * this cluster when the camera surfaces.
 */
export class SceneVisibility {
  constructor(
    private readonly _models: LoadedModels,
    private readonly _fish: FishManager,
  ) {}

  setUnderwaterContent(visible: boolean): void {
    this._fish.setVisible(visible);
    for (const mesh of this._models.oceanFloorObjects.grass) {
      mesh.visible = visible;
    }
    for (const mesh of this._models.oceanFloorObjects.rocks) {
      mesh.visible = visible;
    }
    for (const mesh of this._models.oceanFloorObjects.seaweed) {
      mesh.visible = visible;
    }
  }
}
