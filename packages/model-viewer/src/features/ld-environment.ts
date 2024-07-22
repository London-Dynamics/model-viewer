import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';

import {Water} from './ld-environment/water.js';
import { PlaneGeometry, RepeatWrapping, ShaderMaterial, TextureLoader, Vector3 } from 'three';

const $justAddWater = Symbol('justAddWater');
const $animateEnvironment = Symbol('animateEnvironment');
const $water = Symbol('water');

export declare interface LDEnvironmentInterface {
  waterTexture: string|null;
  waterDistortionScale: number|null;
  waterSize: number|null;
}

export const LDEnvironmentMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDEnvironmentInterface> & T => {
  class LDEnvironmentModelViewerElement extends ModelViewerElement {
    @property({type: String, attribute: 'water-texture'})
    waterTexture: string|null = null;

    @property({type: Number, attribute: 'water-distortion-scale'})
    waterDistortionScale: number|null = null;

    @property({type: Number, attribute: 'water-size'})
    waterSize: number|null = null;

    private [$water]: Water|null = null;

    private[$animateEnvironment]() {
      if(this[$water]) {
        this[$water].animate();
        this[$needsRender]();
        requestAnimationFrame(()=>{this[$animateEnvironment]()});
      }
    }

    private[$justAddWater]() {
      if (this[$scene] && !this[$water]) {
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
						distortionScale: this.waterDistortionScale || 3.7,
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
      }

      if (changedProperties.has('waterDistortionScale') && this[$water] && this.waterDistortionScale) {
        (this[$water].material as ShaderMaterial).uniforms['distortionScale'].value = this.waterDistortionScale;
      }

      if (changedProperties.has('waterSize') && this[$water] && this.waterSize) {
        (this[$water].material as ShaderMaterial).uniforms['size'].value = this.waterSize;
      }
    }
  }

  return LDEnvironmentModelViewerElement;
};
