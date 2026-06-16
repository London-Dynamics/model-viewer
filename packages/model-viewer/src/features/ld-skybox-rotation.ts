import {property} from 'lit/decorators.js';
import {Euler} from 'three';

import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $tick,
} from '../model-viewer-base.js';
import {normalizeUnit} from '../styles/conversions.js';
import {NumberNode, parseExpressions} from '../styles/parsers.js';
import {Constructor} from '../utilities.js';

export type SkyboxRotationAxis = 'x'|'y'|'z';

export declare interface LDSkyboxRotationInterface {
  skyboxRotation: string;
  skyboxRotationAnimation: boolean;
  skyboxRotationAxis: SkyboxRotationAxis;
  skyboxRotationSpeed: string;
}

const $applySkyboxRotation = Symbol('applySkyboxRotation');
const $parseSkyboxRotation = Symbol('parseSkyboxRotation');
const $parseSkyboxRotationSpeed = Symbol('parseSkyboxRotationSpeed');

const DEFAULT_ROTATION = '0deg 0deg 0deg';
const DEFAULT_ROTATION_SPEED = '0deg/s';

export const LDSkyboxRotationMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDSkyboxRotationInterface>&T => {
  class LDSkyboxRotationModelViewerElement extends ModelViewerElement {
    @property({type: String, attribute: 'skybox-rotation'})
    skyboxRotation = DEFAULT_ROTATION;

    @property({type: Boolean, attribute: 'skybox-rotation-animation'})
    skyboxRotationAnimation = false;

    @property({type: String, attribute: 'skybox-rotation-axis'})
    skyboxRotationAxis: SkyboxRotationAxis = 'y';

    @property({type: String, attribute: 'skybox-rotation-speed'})
    skyboxRotationSpeed = DEFAULT_ROTATION_SPEED;

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('skyboxRotation')) {
        this[$applySkyboxRotation]();
      }
    }

    private[$parseSkyboxRotation](): Euler {
      const terms =
          parseExpressions(this.skyboxRotation)[0]?.terms as NumberNode[] |
          undefined;
      const roll = terms?.[0] ?? {type: 'number', number: 0, unit: 'deg'};
      const pitch = terms?.[1] ?? {type: 'number', number: 0, unit: 'deg'};
      const yaw = terms?.[2] ?? {type: 'number', number: 0, unit: 'deg'};

      return new Euler(
          normalizeUnit(pitch).number,
          normalizeUnit(yaw).number,
          normalizeUnit(roll).number,
          'YXZ');
    }

    private[$parseSkyboxRotationSpeed](): number {
      const match = this.skyboxRotationSpeed.trim().match(
          /^(-?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?)\s*(deg|rad)?(?:\s*\/\s*s)?$/i);

      if (match == null) {
        return 0;
      }

      const value = Number(match[1]);
      return match[2]?.toLowerCase() === 'deg' ? value * Math.PI / 180 : value;
    }

    private[$applySkyboxRotation]() {
      this[$scene].setSkyboxRotation(this[$parseSkyboxRotation]());
      this[$needsRender]();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (!this.skyboxRotationAnimation || delta <= 0) {
        return;
      }

      const radiansPerSecond = this[$parseSkyboxRotationSpeed]();
      if (radiansPerSecond === 0) {
        return;
      }

      const rotation = this[$scene].getSkyboxRotation();
      rotation[this.skyboxRotationAxis] += radiansPerSecond * delta * 0.001;
      this[$scene].setSkyboxRotation(rotation);
    }
  }

  return LDSkyboxRotationModelViewerElement;
};
