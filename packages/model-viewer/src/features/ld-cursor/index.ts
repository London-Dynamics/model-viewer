/* @license
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Object3D, Vector2, Vector3, Raycaster } from 'three';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $tick,
} from '../../model-viewer-base.js';
import { Constructor } from '../../utilities.js';
import { Cursor } from './Cursor.js';

const $cursor = Symbol('cursor');
const $updateCursor = Symbol('updateCursor');
const $setCursorVisibility = Symbol('setCursorVisibility');

export const $getCursorPosition = Symbol('getCursorPosition');
export const $setCursorVisible = Symbol('setCursorVisible');
export const $findTargetObject = Symbol('findTargetObject');
export const $getMouseWorldPoint = Symbol('getMouseWorldPoint');

// Type definitions
export interface CursorInterface {
  cursorVisible: boolean;
  cursorSize: number;
  getCursorPosition(): Vector3 | null;
  setCursorVisibility(visible: boolean): void;
}

// Mixin that adds placement cursor functionality
export const LDCursorMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElementBase: T
): Constructor<CursorInterface> & T => {
  class CursorModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'cursor-visible' })
    cursorVisible: boolean = false;

    @property({ type: Number, attribute: 'cursor-size' })
    cursorSize: number = 0.5; // Default diameter of 0.5m

    @property({ type: String, attribute: 'cursor-colour' })
    cursorColour: string = '#165dfc'; // Default to Tailwind Blue 500

    private [$cursor]: Cursor | undefined;

    connectedCallback() {
      super.connectedCallback();
      // Wait for model to load before creating cursor
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this[$cursor]) {
        this[$cursor].cleanup();
        this[$cursor] = undefined;
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (
        changedProperties.has('cursorVisible') ||
        changedProperties.has('cursorSize')
      ) {
        this[$updateCursor]();
      }
    }

    // Public API methods
    [$getCursorPosition](): Vector3 | null {
      return this.getCursorPosition();
    }

    setCursorVisibility(visible: boolean): void {
      this[$setCursorVisibility](visible);
    }

    // Exposed generic symbol to set whatever cursor is present (maps to disc)
    [$setCursorVisible](visible: boolean): void {
      this[$setCursorVisibility](visible);
    }

    // Symbol methods
    getCursorPosition(): Vector3 | null {
      if (this[$cursor]) {
        return this[$cursor].getPosition();
      }
      return null;
    }

    [$setCursorVisibility](visible: boolean): void {
      if (this[$cursor]) {
        this[$cursor].setVisible(visible);
      }
    }

    [$findTargetObject]() {
      let targetObject: Object3D | undefined;

      try {
        this[$scene].traverse((child) => {
          if (child.name === 'Target') {
            targetObject = child;
            throw new Error('found target object'); // Stop traversal when found
          }
        });
      } catch (e) {
        if ((e as Error).message !== 'found target object') throw e;
      }

      return targetObject;
    }

    // Convert client coordinates to a world-space intersection point on the
    // scene's placement plane. Exposed via the symbol above so other mixins
    // can reuse the calculation.
    [$getMouseWorldPoint](clientX: number, clientY: number): Vector3 | null {
      const scene = this[$scene];
      if (!scene) return null;

      const camera = scene.camera;
      if (!camera) return null;

      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;

      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      const ndcX = (mouseX / rect.width) * 2 - 1;
      const ndcY = -(mouseY / rect.height) * 2 + 1;

      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);

      const placementY = scene.boundingBox ? scene.boundingBox.min.y : 0;

      const dir = raycaster.ray.direction;
      const origin = raycaster.ray.origin;

      if (Math.abs(dir.y) > 1e-6) {
        const t = (placementY - origin.y) / dir.y;
        if (t > 0) {
          return origin.clone().add(dir.clone().multiplyScalar(t));
        }
      }

      return null;
    }

    private [$updateCursor](): void {
      try {
        const scene = this[$scene];
        if (!scene) return;

        // Clean up existing cursor
        if (this[$cursor]) {
          this[$cursor].cleanup();
          if (this[$cursor].parent) {
            this[$cursor].parent.remove(this[$cursor]);
          }
          this[$cursor] = undefined;
        }

        const targetObject = this[$findTargetObject]();
        if (targetObject && this.cursorVisible) {
          const radius = this.cursorSize / 2;
          this[$cursor] = new Cursor(
            scene,
            targetObject,
            radius,
            this.cursorColour
          );

          // Use the mixin-provided position-getter so other mixins can reuse it.
          this[$cursor].setupMouseTracking(
            this,
            (clientX: number, clientY: number) =>
              this[$getMouseWorldPoint](clientX, clientY),
            () => this[$needsRender]()
          );
          this[$cursor].setVisible(true);
          this[$needsRender]();
        }
      } catch (error) {
        console.warn('Error updating placement cursors:', error);
      }
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);
      if (this[$cursor]) {
        this[$cursor].tick(time, delta);
      }
    }
  }

  return CursorModelViewerElement as Constructor<CursorInterface> & T;
};
