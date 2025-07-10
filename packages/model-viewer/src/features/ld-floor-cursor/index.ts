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
import { Cursor } from './CursorDisc.js';

const $cursor = Symbol('cursor');
const $updateCursor = Symbol('updateCursor');

export const $getCursorPosition = Symbol('getCursorPosition');
export const $setCursorVisible = Symbol('setCursorVisible');
export const $findTargetObject = Symbol('findTargetObject');

// Mixin that adds placement cursor functionality
export const LDCursorMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElementBase: T
): Constructor<CursorInterface> & T => {
  class CursorModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'floor-cursor' })
    floorCursor: boolean = false;

    @property({ type: Number, attribute: 'floor-cursor-size' })
    floorCursorSize: number = 0.5; // Default diameter of 0.5m

    private [$cursor]: Cursor | undefined;

    connectedCallback() {
      super.connectedCallback();
      // Don't call updateCursor here - wait for model to load
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
        changedProperties.has('floorCursor') ||
        changedProperties.has('floorCursorSize')
      ) {
        this[$updateCursor]();
      }
    }

    // Public API methods
    getCursorPosition(): Vector3 | null {
      return this[$getCursorPosition]();
    }

    setCursorVisible(visible: boolean): void {
      this[$setCursorVisible](visible);
    }

    // Symbol methods
    [$getCursorPosition](): Vector3 | null {
      if (this[$cursor]) {
        return this[$cursor].getPosition();
      }
      return null;
    }

    [$setCursorVisible](visible: boolean): void {
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

    private [$updateCursor](): void {
      // Ensure scene and model are ready before
      try {
        const scene = this[$scene];

        if (!scene) {
          // If scene/model isn't ready yet, don't create cursor
          return;
        }

        // Clean up existing cursor
        if (this[$cursor]) {
          this[$cursor].cleanup();
          if (this[$cursor].parent) {
            this[$cursor].parent.remove(this[$cursor]);
          }
          this[$cursor] = undefined;
        }

        // Create new cursor if enabled
        const targetObject = this[$findTargetObject]();
        if (this.floorCursor && targetObject) {
          const radius = this.floorCursorSize / 2; // Convert diameter to radius

          this[$cursor] = new Cursor(scene, targetObject, radius);
          this[$cursor].setVisible(true);
          this[$cursor].setupMouseTracking(this, () => this[$needsRender]());
          this[$needsRender]();
        }
      } catch (error) {
        console.warn('Error updating placement cursor:', error);
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

// Type definitions
export interface CursorInterface {
  floorCursor: boolean;
  floorCursorSize: number;
  getCursorPosition(): Vector3 | null;
  setCursorVisible(visible: boolean): void;
}
