import { Object3D, Vector3 } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

export declare interface LDStageManagerInterface {
  updateCameraPosition(position: [number, number, number]): void;
  getCameraPosition(): Vector3;
}

const $theCamera = Symbol('theCamera');

export const LDStageManagerMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDStageManagerInterface> & T => {
  class LDStageManagerModelViewerElement extends ModelViewerElement {
    private [$theCamera] = new Object3D();

    private async _prepareScene() {
      this[$scene].updateBoundingBox();
      this[$scene].queueRender();
    }

    updateCameraPosition(position: [number, number, number]) {
      console.log(this[$theCamera].position);
      this[$theCamera].position.set(...position);
      this._prepareScene();
    }

    getCameraPosition() {
      return this[$theCamera].position;
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
        const scene = this[$scene];

        this[$theCamera] = scene.getCamera();
      }
    }
  }

  return LDStageManagerModelViewerElement;
};
