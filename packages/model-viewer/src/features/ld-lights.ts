import { property } from 'lit/decorators.js';
import type { Light, Material, Mesh, MeshStandardMaterial } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';


export declare interface LDLightsInterface {
  lights: boolean;
  toggleLights(state?: boolean): boolean;
  applyModelLights(on: boolean): void;
}

const $traverseAndToggleLights = Symbol('traverseAndToggleLights');
const AUTHORED_EMISSIVE_INTENSITY = 'ldLightsEmissiveIntensity';

const materialList = (mesh: Mesh): Material[] => {
  if (mesh.material == null) {
    return [];
  }
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
};

export const LDLightsMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDLightsInterface> & T => {
  class LDLightsModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'lights'})
    lights: boolean = false;

    private emissiveLightsFollow = false;

    private[$traverseAndToggleLights] =
        (lights: boolean, includeEmissive: boolean) => {
          this[$scene].traverse((object) => {
            const light = object as Light;
            if (light.isLight) {
              light.visible = lights;
            }
            if (!includeEmissive) {
              return;
            }
            for (const material of materialList(object as Mesh)) {
              const standard = material as MeshStandardMaterial;
              if (standard.emissive == null || standard.emissiveIntensity == null) {
                continue;
              }
              if (standard.userData[AUTHORED_EMISSIVE_INTENSITY] == null) {
                standard.userData[AUTHORED_EMISSIVE_INTENSITY] =
                    standard.emissiveIntensity;
              }
              const authored = standard.userData[AUTHORED_EMISSIVE_INTENSITY] as number;
              standard.emissiveIntensity = lights ? authored : 0;
            }
          });

          this[$needsRender]();
        }

    toggleLights(state?: boolean) {
      const lightsOn = typeof state !== 'undefined' ? state : !this.lights;
      this.applyModelLights(lightsOn);
      return lightsOn;
    }

    applyModelLights(on: boolean) {
      this.emissiveLightsFollow = true;
      if (this.lights === on) {
        this[$traverseAndToggleLights](on, true);
        return;
      }
      this.lights = on;
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);
      if (changedProperties.has('lights')) {
        this.emissiveLightsFollow = true;
        this[$traverseAndToggleLights](this.lights, true);
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      this[$traverseAndToggleLights](this.lights, this.emissiveLightsFollow);
    }
  }

  return LDLightsModelViewerElement;
};
