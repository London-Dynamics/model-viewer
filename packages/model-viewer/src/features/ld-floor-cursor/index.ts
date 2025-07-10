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

import { Object3D, Vector3 } from 'three';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $tick,
} from '../../model-viewer-base.js';
import { Constructor } from '../../utilities.js';
import { Cursor as ArrowCursor } from './CursorArrow.js';
import { Cursor as DiscCursor } from './CursorDisc.js';

const $arrowCursor = Symbol('arrowCursor');
const $discCursor = Symbol('discCursor');
const $updateCursors = Symbol('updateCursors');
const $getArrowCursorPosition = Symbol('getArrowCursorPosition');
const $getDiscCursorPosition = Symbol('getDiscCursorPosition');
const $setArrowCursorVisible = Symbol('setArrowCursorVisible');
const $setDiscCursorVisible = Symbol('setDiscCursorVisible');

export const $getCursorPosition = Symbol('getCursorPosition');
export const $setCursorVisible = Symbol('setCursorVisible');
export const $findTargetObject = Symbol('findTargetObject');

// Mixin that adds placement cursor functionality
export const LDCursorMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElementBase: T
): Constructor<CursorInterface> & T => {
  class CursorModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'floor-arrow-cursor' })
    floorArrowCursor: boolean = false;

    @property({ type: Boolean, attribute: 'floor-disc-cursor' })
    floorDiscCursor: boolean = false;

    @property({ type: Number, attribute: 'floor-arrow-cursor-size' })
    floorArrowCursorSize: number = 0.5; // Default diameter of 0.5m

    @property({ type: Number, attribute: 'floor-disc-cursor-size' })
    floorDiscCursorSize: number = 0.5; // Default diameter of 0.5m

    private [$arrowCursor]: ArrowCursor | undefined;
    private [$discCursor]: DiscCursor | undefined;

    connectedCallback() {
      super.connectedCallback();
      // Don't call updateCursor here - wait for model to load
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this[$arrowCursor]) {
        this[$arrowCursor].cleanup();
        this[$arrowCursor] = undefined;
      }
      if (this[$discCursor]) {
        this[$discCursor].cleanup();
        this[$discCursor] = undefined;
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (
        changedProperties.has('floorArrowCursor') ||
        changedProperties.has('floorArrowCursorSize') ||
        changedProperties.has('floorDiscCursor') ||
        changedProperties.has('floorDiscCursorSize')
      ) {
        this[$updateCursors]();
      }
    }

    // Public API methods
    getArrowCursorPosition(): Vector3 | null {
      return this[$getArrowCursorPosition]();
    }

    getDiscCursorPosition(): Vector3 | null {
      return this[$getDiscCursorPosition]();
    }

    setArrowCursorVisible(visible: boolean): void {
      this[$setArrowCursorVisible](visible);
    }

    setDiscCursorVisible(visible: boolean): void {
      this[$setDiscCursorVisible](visible);
    }

    // Symbol methods
    [$getArrowCursorPosition](): Vector3 | null {
      if (this[$arrowCursor]) {
        return this[$arrowCursor].getPosition();
      }
      return null;
    }

    [$getDiscCursorPosition](): Vector3 | null {
      if (this[$discCursor]) {
        return this[$discCursor].getPosition();
      }
      return null;
    }

    [$setArrowCursorVisible](visible: boolean): void {
      if (this[$arrowCursor]) {
        this[$arrowCursor].setVisible(visible);
      }
    }

    [$setDiscCursorVisible](visible: boolean): void {
      if (this[$discCursor]) {
        this[$discCursor].setVisible(visible);
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

    private [$updateCursors](): void {
      try {
        const scene = this[$scene];
        if (!scene) return;

        // Clean up existing cursors
        if (this[$arrowCursor]) {
          this[$arrowCursor].cleanup();
          if (this[$arrowCursor].parent) {
            this[$arrowCursor].parent.remove(this[$arrowCursor]);
          }
          this[$arrowCursor] = undefined;
        }
        if (this[$discCursor]) {
          this[$discCursor].cleanup();
          if (this[$discCursor].parent) {
            this[$discCursor].parent.remove(this[$discCursor]);
          }
          this[$discCursor] = undefined;
        }

        const targetObject = this[$findTargetObject]();
        if (targetObject) {
          if (this.floorArrowCursor) {
            const radius = this.floorArrowCursorSize / 2;
            this[$arrowCursor] = new ArrowCursor(scene, targetObject, radius);
            this[$arrowCursor].setVisible(true);
            this[$arrowCursor].setupMouseTracking(this, () =>
              this[$needsRender]()
            );
          }
          if (this.floorDiscCursor) {
            const radius = this.floorDiscCursorSize / 2;
            this[$discCursor] = new DiscCursor(scene, targetObject, radius);
            this[$discCursor].setVisible(true);
            this[$discCursor].setupMouseTracking(this, () =>
              this[$needsRender]()
            );
          }
          if (this.floorArrowCursor || this.floorDiscCursor) {
            this[$needsRender]();
          }
        }
      } catch (error) {
        console.warn('Error updating placement cursors:', error);
      }
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);
      if (this[$arrowCursor]) {
        this[$arrowCursor].tick(time, delta);
      }
      if (this[$discCursor]) {
        this[$discCursor].tick(time, delta);
      }
    }
  }

  return CursorModelViewerElement as Constructor<CursorInterface> & T;
};

// Type definitions
export interface CursorInterface {
  floorArrowCursor: boolean;
  floorDiscCursor: boolean;
  floorArrowCursorSize: number;
  floorDiscCursorSize: number;
  getArrowCursorPosition(): Vector3 | null;
  getDiscCursorPosition(): Vector3 | null;
  setArrowCursorVisible(visible: boolean): void;
  setDiscCursorVisible(visible: boolean): void;
}
