import { property } from 'lit/decorators.js';
import {
  MathUtils,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  TextureLoader,
  Vector3,
} from 'three';
import { Renderer } from '../../three-components/Renderer.js';
import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../../model-viewer-base.js';

import { Constructor } from '../../utilities.js';

import { Water } from './water.js';
import { Sky } from './sky.js';

const $justAddWater = Symbol('justAddWater');
const $addSky = Symbol('addSky');
const $updateSun = Symbol('updateSun');
const $animateEnvironment = Symbol('animateEnvironment');
const $water = Symbol('water');
const $sun = Symbol('sun');
const $sky = Symbol('sky');
const $pmremGenerator = Symbol('pmremGenerator');
const $sceneEnv = Symbol('sceneEnv');
const $renderTarget = Symbol('renderTarget');

export declare interface LDEnvironmentInterface {
  sky: boolean | null;
  sunAzimuth: number | undefined;
  sunElevation: number | undefined;
  waterTexture: string | null;
  waterDistortionScale: number | null;
  waterSize: number | null;
}

export const LDEnvironmentMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDEnvironmentInterface> & T => {
  class LDEnvironmentModelViewerElement extends ModelViewerElement {
    @property({ type: String, attribute: 'water-texture' })
    waterTexture: string | null = null;

    @property({ type: Number, attribute: 'water-distortion-scale' })
    waterDistortionScale: number | null = null;

    @property({ type: Number, attribute: 'water-size' })
    waterSize: number | null = null;

    @property({ type: Number, attribute: 'sky' })
    sky: boolean | null = null;

    @property({ type: Number, attribute: 'sun-elevation' })
    sunElevation: number | undefined = undefined;

    @property({ type: Number, attribute: 'sun-azimuth' })
    sunAzimuth: number | undefined = undefined;

    private [$water]: Water | null = null;
    private [$sky]: Sky | null = null;
    private [$sun]: Vector3 | null = null;
    private [$pmremGenerator]: PMREMGenerator | null = null;
    private [$sceneEnv]: any = null;
    private [$renderTarget]: any = null;

    private [$animateEnvironment]() {
      if (this[$water]) {
        this[$water].animate();
        this[$needsRender]();
        requestAnimationFrame(() => {
          this[$animateEnvironment]();
        });
      }
    }

    private [$justAddWater]() {
      if (this[$scene] && !this[$water]) {
        const { waterTexture } = this;

        const waterGeometry = new PlaneGeometry(10000, 10000);

        this[$water] = new Water(waterGeometry, {
          textureWidth: 512,
          textureHeight: 512,
          waterNormals: new TextureLoader().load(
            waterTexture!,
            function (texture) {
              texture.wrapS = texture.wrapT = RepeatWrapping;
            }
          ),
          sunDirection: new Vector3(),
          sunColor: 0xd3e8ff,
          waterColor: 0x001e0f,
          distortionScale: this.waterDistortionScale || 3.7,
          fog: this[$scene].fog !== undefined,
        });

        /* This to make sure plane is at floor level */
        this[$water].rotation.x = -Math.PI / 2;

        this[$scene].add(this[$water]);

        this[$animateEnvironment]();
      }
    }

    private [$updateSun](elevation: number = 2, azimuth: number = 180) {
      if (
        !this[$sun] ||
        !this[$sky] ||
        !this[$water] ||
        !this[$pmremGenerator]
      ) {
        return;
      }

      const phi = MathUtils.degToRad(90 - elevation);
      const theta = MathUtils.degToRad(azimuth);

      this[$sun].setFromSphericalCoords(1, phi, theta);

      (this[$sky].material as ShaderMaterial).uniforms[
        'sunPosition'
      ].value.copy(this[$sun]);
      (this[$water].material as ShaderMaterial).uniforms['sunDirection'].value
        .copy(this[$sun])
        .normalize();

      if (this[$renderTarget]) this[$renderTarget].dispose();

      this[$sceneEnv].add(this[$sky]);
      this[$renderTarget] = this[$pmremGenerator].fromScene(this[$sceneEnv]);
      this[$scene].add(this[$sky]);

      this[$scene].environment = this[$renderTarget].texture;
    }

    private [$addSky]() {
      this[$sun] = new Vector3();

      this[$sky] = new Sky();
      this[$sky].scale.setScalar(10000);
      this[$scene].add(this[$sky]);

      const skyUniforms = (this[$sky].material as ShaderMaterial).uniforms;

      skyUniforms['turbidity'].value = 10;
      skyUniforms['rayleigh'].value = 2;
      skyUniforms['mieCoefficient'].value = 0.005;
      skyUniforms['mieDirectionalG'].value = 0.8;

      this[$pmremGenerator] = new PMREMGenerator(
        Renderer.singleton.threeRenderer
      );
      this[$sceneEnv] = new Scene();
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('waterTexture') && this.waterTexture != null) {
        this[$justAddWater]();
      }

      if (changedProperties.has('sky') && this.sky != null) {
        this[$addSky]();
        this[$updateSun](this.sunElevation, this.sunAzimuth);
      }

      if (
        (changedProperties.has('sunElevation') && this.sunElevation != null) ||
        (changedProperties.has('sunAzimuth') && this.sunAzimuth != null)
      ) {
        this[$updateSun](this.sunElevation, this.sunAzimuth);
      }

      if (
        changedProperties.has('waterDistortionScale') &&
        this[$water] &&
        this.waterDistortionScale
      ) {
        (this[$water].material as ShaderMaterial).uniforms[
          'distortionScale'
        ].value = this.waterDistortionScale;
      }

      if (
        changedProperties.has('waterSize') &&
        this[$water] &&
        this.waterSize
      ) {
        (this[$water].material as ShaderMaterial).uniforms['size'].value =
          this.waterSize;
      }
    }
  }

  return LDEnvironmentModelViewerElement;
};
