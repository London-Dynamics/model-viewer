//import { Spherical, Vector3 } from 'three';
//import { PerspectiveCamera } from 'three';
//import {PerspectiveCamera} from 'three';
import ModelViewerElementBase, {
  //$needsRender,
  $scene,
  // $userInputElement,
  $onModelLoad,
} from "../model-viewer-base.js";

import { $controls } from "./controls.js";
//import {SmoothControls} from '../three-components/SmoothControls.js';
import { Constructor } from "../utilities.js";
import { Mesh } from "three";

export interface ClickDetails {
  geometry?: string;
  material?: string;
  mesh?: string;
}

type CameraMeta = {
  metadata: object;
  object: {
    [key: string]: any;
  };
};

export declare interface LDCameraInterface {
  setCameraFromJSON(json: CameraMeta["object"]): void;
  getCameraMeta(): CameraMeta | null;
}

export const LDCameraMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDCameraInterface> & T => {
  class LDCameraModelViewerElement extends ModelViewerElement {
    // protected[$controls] = new SmoothControls(
    //     this[$scene].camera as PerspectiveCamera, this[$userInputElement],
    //     this[$scene]);

    private _pointerDwn = [0, 0];
    private _pointerUp = [0, 0];

    handleClick(event: MouseEvent) {
      const { _pointerDwn, _pointerUp } = this;
      const d = Math.hypot(
        _pointerUp[0] - _pointerDwn[0],
        _pointerUp[1] - _pointerDwn[1]
      );
      /* This to allow for a small drag on sensetive input devices */
      if (d > 4) return;

      const { clientX, clientY } = event;

      const scene = this[$scene];
      const ndcCoords = scene.getNDC(clientX, clientY);
      const hit = scene.hitFromPoint(ndcCoords);

      if (hit) {
        const { object } = hit;

        if (object && object.isObject3D && object.visible) {
          const detail: ClickDetails = {};
          const { material, name, geometry } = object as Mesh;

          if (name) {
            detail.mesh = name;
          }

          if (geometry) {
            detail.geometry = geometry.name;
          }

          if (typeof material !== "undefined" && !Array.isArray(material)) {
            detail.material = material.name;
          }
          this.dispatchEvent(
            new CustomEvent<ClickDetails>("click", { detail })
          );
        }
      }
    }

    async setCameraFromJSON(json: CameraMeta["object"]) {
      // @ts-ignore
      const controls = this[$controls];
      const { camera } = controls;

      console.log("scene", this[$scene]);
      console.log("camera", camera);
      console.log("controls", controls);

      Object.keys(json).forEach((key) => {
        const value = json[key];

        if (camera.hasOwnProperty(key) && camera[key] !== value) {
          switch (key) {
            case "matrix":
              //console.log("setting camera property", key, value);

              //camera.applyMatrix4(new Matrix4().fromArray(value));
              //camera.updateMatrixWorld( true );

              break;
            case "up":
              // @ts-ignore
              //camera.up = new Vector3().fromArray(value);
              break;
            default:
              console.log("setting camera property", key, value);

            //camera[key] = value;
          }
          //controls.update(77);

          //const setFunction = camera[`set${key[0].toUpperCase()}${key.slice(1)}`];
          //console.log("function", `set${key[0].toUpperCase()}${key.slice(1)}`);
        }
      });

      //camera.updateProjectionMatrix();
      //const spherical = controls.getCameraSpherical();
      //console.log("spherical",spherical)

      //const vector = new Vector3();
      //camera.getWorldDirection(vector);
      //const spherical = new Spherical().setFromVector3(vector);
      //console.log("vector", vector);
      //console.log("spherical", spherical);
      //controls.goalSpherical = spherical;
      //controls.update(77);
      //this[$scene].updateBoundingBox();

      //this.dispatchEvent({type: 'user-interaction'});
      //controls.update();

      //      controls.enabled = true;

      //controls.update();
      // @ts-ignore

      //console.log("controls.getFieldOfView()",controls.getFieldOfView());

      //await this[$scene].updateFraming();

      //this[$scene].updateWorldMatrix();
      //this[$needsRender]();
    }

    getCameraMeta() {
      const { camera } = this[$scene];

      if (camera) return camera?.toJSON() || null;

      return null;
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
      }

      this.addEventListener("pointerdown", (e) => {
        this._pointerDwn = [e.offsetX, e.offsetY];
      });
      this.addEventListener("pointerup", (e) => {
        this._pointerUp = [e.offsetX, e.offsetY];
      });
      this.addEventListener("click", this.handleClick);
    }
  }
  // @ts-ignore
  return LDCameraModelViewerElement;
};
