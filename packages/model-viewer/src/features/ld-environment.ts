import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';

import {Water} from './ld-environment/water.js';
import { PlaneGeometry, RepeatWrapping, TextureLoader, Vector3 } from 'three';

const $justAddWater = Symbol('justAddWater');
const $animateEnvironment = Symbol('animateEnvironment');
const $water = Symbol('water');

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

    private [$water]: Water|null = null;

    private[$animateEnvironment]() {
      if(this[$water]) {
        this[$water].animate();
        this[$needsRender]();
        requestAnimationFrame(()=>{this[$animateEnvironment]()});
      }
    }

    private[$justAddWater]() {
      if (this[$scene]) {
        const {waterTexture} = this;

        const waterGeometry = new PlaneGeometry( 10000, 10000 );

        this[$water] = new Water(
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

        /* This to make sure plane is at floor level */
				this[$water].rotation.x = - Math.PI / 2;

				this[$scene].add( this[$water] );

        this[$animateEnvironment]();
      }
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('waterTexture') && this.waterTexture != null) {
        this[$justAddWater]();
        this[$needsRender]();
      }
    }
  }

  return LDEnvironmentModelViewerElement;
};
