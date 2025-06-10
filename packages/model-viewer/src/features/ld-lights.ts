import { property } from 'lit/decorators.js';
import type { Light } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';


export declare interface LDLightsInterface {
  lights: boolean;
  toggleLights(state?: boolean): boolean;
}

const $traverseAndToggleLights = Symbol('traverseAndToggleLights');

export const LDLightsMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDLightsInterface> & T => {
  class LDLightsModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'lights'})
    lights: boolean = false;

    private[$traverseAndToggleLights] = (lights: boolean) => {
      this[$scene].traverse( function ( object ) {
        const light = object as Light;

        if (light.isLight) {
						light.visible = lights;
				}
      });

      this[$needsRender]();
    }

    toggleLights(state?: boolean) {
      const lightsOn = typeof state !== 'undefined' ? state : !this.lights;

      this.lights = lightsOn;

      return lightsOn;
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);
      if (changedProperties.has('lights')) {
         this[$traverseAndToggleLights](this.lights);
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      this[$traverseAndToggleLights](this.lights);
    }
  }

  return LDLightsModelViewerElement;
};
