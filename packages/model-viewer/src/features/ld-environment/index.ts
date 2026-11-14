import {property} from 'lit/decorators.js';
import {Euler, Object3D} from 'three';

import ModelViewerElementBase, {$awaitInitialEnvironment, $markLoaded, $needsRender, $renderer, $scene, $updateCameraClipping, $updateLDEnvironment,} from '../../model-viewer-base.js';
import {normalizeUnit} from '../../styles/conversions.js';
import {NumberNode, parseExpressions} from '../../styles/parsers.js';
import {Constructor, deserializeUrl} from '../../utilities.js';

/**
 * Default is true when the attribute is omitted. Lit's Boolean converter
 * treats any present attribute as true, including the string "false", so this
 * converter accepts that explicit off value. Removing the attribute restores
 * the default.
 */
const clipToEnvConverter = {
  fromAttribute(value: string|null): boolean {
    if (value == null) {
      return true;
    }
    return value.trim().toLowerCase() !== 'false';
  },
};

export declare interface LDEnvironmentInterface {
  environmentModel: string|null;
  environmentModelPosition: string;
  environmentModelOrientation: string;
  environmentModelScale: string;
  /**
   * When true (default), extend the camera far plane so a loaded environment
   * model stays inside the frustum. Does not hide or show the environment.
   * Set false to keep the far plane derived from the maximum camera orbit.
   * Near, zoom limits, and product framing are unchanged either way.
   */
  clipToEnv: boolean;
}

export const LDEnvironmentMixin =
    <T extends Constructor<ModelViewerElementBase>>(
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

        @property({
          attribute: 'clip-to-env',
          converter: clipToEnvConverter,
        })
        clipToEnv = true;

        private environmentModelLoadId = 0;
        private hasRevealedProduct = false;
        private environmentGatePending = false;
        private environmentGateId = 0;
        private loadedEnvironmentUrl: string|null = null;
        private environmentGate: Promise<void> = Promise.resolve();
        private finishEnvironmentGate: () => void = () => {};

        updated(changedProperties: Map<string|number|symbol, unknown>) {
          if (!this.hasRevealedProduct) {
            this.beginEnvironmentGate();
          }

          super.updated(changedProperties);

          // The environment model is independent of the product src. A src
          // change must not clear, hide, or reload it. The first reveal waits
          // until this load settles; later src changes do not.
          if (changedProperties.has('environmentModel')) {
            if (this.environmentModel == null) {
              this.loadedEnvironmentUrl = null;
              this.finishEnvironmentGate();
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

          if (changedProperties.has('clipToEnv')) {
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
          const terms =
              parseExpressions(value)[0]?.terms as NumberNode[] | undefined;

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
          environmentRoot.scale.set(
              scaleX.number, scaleY.number, scaleZ.number);
          this[$needsRender]();
          this[$updateCameraClipping]();
        }

        [$markLoaded]() {
          super[$markLoaded]();
          this.hasRevealedProduct = true;
        }

        /**
         * Resolves when the environment model for the first reveal has loaded
         * or failed. Product-only scenes and later src changes resolve
         * immediately.
         */
        [$awaitInitialEnvironment](): Promise<void> {
          if (this.hasRevealedProduct) {
            return Promise.resolve();
          }
          const url = deserializeUrl(this.environmentModel);
          if (url == null || url === this.loadedEnvironmentUrl) {
            return Promise.resolve();
          }
          this.beginEnvironmentGate();
          return this.environmentGate;
        }

        private beginEnvironmentGate() {
          if (this.hasRevealedProduct || this.environmentGatePending) {
            return;
          }
          const url = deserializeUrl(this.environmentModel);
          if (url == null || url === this.loadedEnvironmentUrl) {
            return;
          }
          this.environmentGatePending = true;
          const gateId = ++this.environmentGateId;
          this.environmentGate = new Promise((resolve) => {
            this.finishEnvironmentGate = () => {
              if (gateId !== this.environmentGateId) {
                return;
              }
              this.environmentGatePending = false;
              this.finishEnvironmentGate = () => {};
              resolve();
            };
          });
        }

        private completeEnvironmentGate(url: string) {
          this.loadedEnvironmentUrl = url;
          this.finishEnvironmentGate();
        }

        async[$updateLDEnvironment]() {
          const loadId = ++this.environmentModelLoadId;
          const url = deserializeUrl(this.environmentModel);

          // An empty value clears now. A replacement stays on screen until its
          // load settles, then swaps in the same turn as the render request.
          if (url == null) {
            this.loadedEnvironmentUrl = null;
            this.finishEnvironmentGate();
            this[$scene].clearEnvironmentModel();
            this[$needsRender]();
            return;
          }

          try {
            // Load beside src. Framing stays on the product scene; this root
            // is not part of the target bounds. The environment bucket is not
            // subject to modelCacheSize. The first reveal waits for this
            // attempt to settle.
            const gltf = await this[$renderer].loader.load(
                url, this, undefined, 'environment');
            if (loadId !== this.environmentModelLoadId ||
                url !== deserializeUrl(this.environmentModel)) {
              gltf.dispose();
              return;
            }

            this.prepareEnvironmentModel(gltf.scene);
            // Removes the previous model, adds this one, then queues a render
            // and refreshes clip / environment bounds.
            this[$scene].setEnvironmentModel(gltf.scene, () => gltf.dispose());
            this.dispatchEvent(
                new CustomEvent('environment-model-load', {detail: {url}}));
          } catch (error) {
            if (loadId !== this.environmentModelLoadId) {
              return;
            }

            // The attribute names a model we do not have. Drop the previous
            // set instead of leaving it up under the new URL.
            this[$scene].clearEnvironmentModel();
            this.dispatchEvent(new CustomEvent(
                'environment-model-error', {detail: {url, error}}));
          } finally {
            if (loadId === this.environmentModelLoadId) {
              this.completeEnvironmentGate(url);
            }
            this[$needsRender]();
          }
        }
      }

      return LDEnvironmentModelViewerElement;
    };
