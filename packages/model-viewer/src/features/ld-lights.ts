import ModelViewerElementBase, {
  // $scene,
  $onModelLoad,
} from '../model-viewer-base.js';



import { Constructor } from '../utilities.js';


export declare interface LDLightsInterface {
  toggleLights(state?: boolean): boolean;
}

export const LDLightsMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDLightsInterface> & T => {
  class LDLightsModelViewerElement extends ModelViewerElement {
    // protected[$controls] = new SmoothControls(
    //     this[$scene].camera as PerspectiveCamera, this[$userInputElement],
    //     this[$scene]);



    toggleLights(state?: boolean) {
      // const {camera} = this[$scene];

      // console.log("toggle lights!")

      return !state;
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      // const { currentGLTF } = this[$scene];

      // if (currentGLTF != null) {

      // }
    }
  }

  return LDLightsModelViewerElement;
};
