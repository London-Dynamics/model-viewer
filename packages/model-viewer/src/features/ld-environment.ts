import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';

import {Water} from './ld-environment/water.js';
import { PlaneGeometry, RepeatWrapping, TextureLoader, Vector3 } from 'three';

const $justAddWater = Symbol('justAddWater');


export declare interface LDEnvironmentInterface {
  waterTexture: string|null;
}

export const LDEnvironmentMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDEnvironmentInterface> & T => {
  class LDEnvironmentModelViewerElement extends ModelViewerElement {
    @property({type: String, attribute: 'water-texture'})
    waterTexture: string|null = null;

    water: Water|null = null;

    private[$justAddWater]() {
      if (this[$scene]) {


        const {waterTexture} = this;

        const waterGeometry = new PlaneGeometry( 10000, 10000 );
        console.log("loading water texture!!!")
        this.water = new Water(
					waterGeometry,
					{
						textureWidth: 512,
						textureHeight: 512,
						waterNormals: new TextureLoader().load( waterTexture!, function ( texture ) {
							texture.wrapS = texture.wrapT = RepeatWrapping;
						} ),
						sunDirection: new Vector3(),
						sunColor: 0xffffff,
						waterColor: 0x001e0f,
						distortionScale: 3.7,
						fog: this[$scene].fog !== undefined
					}
				);

				this.water.rotation.x = - Math.PI / 2;
        this.water.translateZ(-0.6);

				this[$scene].add( this.water );
      }
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('waterTexture')) {
        console.log("has water texture!!!")
        this[$justAddWater]();
        this[$needsRender]();
      }
    }
  }

  return LDEnvironmentModelViewerElement;
};
