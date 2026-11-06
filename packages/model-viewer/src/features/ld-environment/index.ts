import {property} from 'lit/decorators.js';
import {Euler, Object3D} from 'three';

import ModelViewerElementBase, {
  $needsRender,
  $renderer,
  $scene,
  $updateCameraClipping,
  $updateLDEnvironment,
} from '../../model-viewer-base.js';
import {normalizeUnit} from '../../styles/conversions.js';
import {NumberNode, parseExpressions} from '../../styles/parsers.js';
import {Constructor, deserializeUrl} from '../../utilities.js';

export type EnvironmentClipping = 'auto'|'legacy';

export declare interface LDEnvironmentInterface {
  environmentModel: string|null;
  environmentModelPosition: string;
  environmentModelOrientation: string;
  environmentModelScale: string;
  /**
   * `auto` (default) extends the far plane so a loaded environment model stays
   * visible without changing orbit limits. `legacy` keeps the orbit-derived
   * far plane. Near is unchanged either way. Scenes with no environment model
   * always use the legacy plane.
   */
  environmentClipping: EnvironmentClipping;
}

export const LDEnvironmentMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<LDEnvironmentInterface>&T => {
  class LDEnvironmentModelViewerElement extends ModelViewerElement {
    @property({type: String, attribute: 'environment-model'})
    environmentModel: string|null = null;

    @property({type: String, attribute: 'environment-model-position'})
    environmentModelPosition: string = '0m 0m 0m';

    @property({type: String, attribute: 'environment-model-orientation'})
    environmentModelOrientation: string = '0deg 0deg 0deg';

    @property({type: String, attribute: 'environment-model-scale'})
    environmentModelScale: string = '1 1 1';

    @property({type: String, attribute: 'environment-clipping'})
    environmentClipping: EnvironmentClipping = 'auto';

    private environmentModelLoadId = 0;

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('src')) {
        this.clearEnvironmentModel();
      }

      if (changedProperties.has('environmentModel')) {
        if (this.environmentModel == null) {
          this.clearEnvironmentModel();
        } else {
          this[$updateLDEnvironment]();
        }
      }

      if (changedProperties.has('environmentModelPosition') ||
          changedProperties.has('environmentModelOrientation') ||
          changedProperties.has('environmentModelScale')) {
        this.updateEnvironmentModelTransform();
      }

      if (changedProperties.has('environmentClipping')) {
        this[$updateCameraClipping]();
      }
    }

    private clearEnvironmentModel() {
      this.environmentModelLoadId++;
      this[$scene].clearEnvironmentModel();
      this[$needsRender]();
    }

    private prepareEnvironmentModel(root: Object3D) {
      root.traverse((node: Object3D) => {
        node.userData.noHit = true;
        node.userData.selectable = false;

        if ('castShadow' in node) {
          (node as any).castShadow = false;
        }

        if ('receiveShadow' in node) {
          (node as any).receiveShadow = false;
        }
      });
    }

    private parseVector3(value: string, fallback: [number, number, number]):
        [NumberNode, NumberNode, NumberNode] {
      const terms = parseExpressions(value)[0]?.terms as NumberNode[] |
          undefined;

      return [
        terms?.[0] ?? {type: 'number', number: fallback[0], unit: null},
        terms?.[1] ?? {type: 'number', number: fallback[1], unit: null},
        terms?.[2] ?? {type: 'number', number: fallback[2], unit: null},
      ];
    }

    private updateEnvironmentModelTransform() {
      const [x, y, z] =
          this.parseVector3(this.environmentModelPosition, [0, 0, 0]);
      const [roll, pitch, yaw] =
          this.parseVector3(this.environmentModelOrientation, [0, 0, 0]);
      const [scaleX, scaleY, scaleZ] =
          this.parseVector3(this.environmentModelScale, [1, 1, 1]);
      const environmentRoot = this[$scene].environmentRoot;

      environmentRoot.position.set(
          normalizeUnit(x).number,
          normalizeUnit(y).number,
          normalizeUnit(z).number);
      environmentRoot.quaternion.setFromEuler(new Euler(
          normalizeUnit(pitch).number,
          normalizeUnit(yaw).number,
          normalizeUnit(roll).number,
          'YXZ'));
      environmentRoot.scale.set(scaleX.number, scaleY.number, scaleZ.number);
      this[$needsRender]();
      this[$updateCameraClipping]();
    }

    async[$updateLDEnvironment]() {
      const loadId = ++this.environmentModelLoadId;
      const url = deserializeUrl(this.environmentModel);

      this[$scene].clearEnvironmentModel();

      if (url == null || !this.loaded) {
        this[$needsRender]();
        return;
      }

      try {
        const gltf = await this[$renderer].loader.load(url, this);
        if (loadId !== this.environmentModelLoadId ||
            url !== deserializeUrl(this.environmentModel)) {
          gltf.dispose();
          return;
        }

        this.prepareEnvironmentModel(gltf.scene);
        this[$scene].setEnvironmentModel(gltf.scene, () => gltf.dispose());
        this.dispatchEvent(
            new CustomEvent('environment-model-load', {detail: {url}}));
      } catch (error) {
        if (loadId !== this.environmentModelLoadId) {
          return;
        }

        this.dispatchEvent(new CustomEvent(
            'environment-model-error', {detail: {url, error}}));
      } finally {
        this[$needsRender]();
      }
    }
  }

  return LDEnvironmentModelViewerElement;
};
