import { Object3D } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

export declare interface LDStageManagerInterface {
  updateCameraPosition(position: [number, number, number]): void;
  getCameraPosition(): number[];
}

const $theCamera = Symbol('theCamera');

export const LDStageManagerMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDStageManagerInterface> & T => {
  class LDStageManagerModelViewerElement extends ModelViewerElement {
    private [$theCamera] = new Object3D();

    updateCameraPosition(position: [number, number, number]) {
      console.log(this[$theCamera].position);
      this[$theCamera].position.set(...position);
      this[$scene].updateBoundingBox();
      this[$scene].queueRender();
    }

    getCameraPosition() {
      const position = this[$theCamera].position;

      return [position.x, position.y, position.z];
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
