//import { Object3D } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

export declare interface LDThreeInterface {
  set3DCamera(): void;
  get3DCamera(): void;
}


export const LDThreeMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDThreeInterface> & T => {
  class LDThreeModelViewerElement extends ModelViewerElement {


    set3DCamera() {

    }

    get3DCamera() {

    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {

      }
    }
  }

  return LDThreeModelViewerElement;
};
