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

import { Vector3, Box3, Object3D } from 'three';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
  $tick,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

const $modularControlsContainer = Symbol('modularControlsContainer');
const $selectedObject = Symbol('selectedObject');
const $updateModularControls = Symbol('updateModularControls');
const $worldToScreen = Symbol('worldToScreen');

export const $selectObjectForControls = Symbol('selectObjectForControls');
export const $clearSelectedObject = Symbol('clearSelectedObject');

// Mixin that adds floating controls functionality
export const FloatingControlsMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElementBase: T
): Constructor<FloatingControlsInterface> & T => {
  class FloatingControlsModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'floating-controls-enabled' })
    floatingControlsEnabled: boolean = false;

    private [$modularControlsContainer]: HTMLElement | null = null;
    private [$selectedObject]: Object3D | null = null;

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$modularControlsContainer] = this.shadowRoot?.querySelector(
        'slot[name="modular-controls"]'
      ) as HTMLElement;
    }

    [$selectObjectForControls](object: Object3D): void {
      this[$selectedObject] = object;
      this[$updateModularControls]();
    }

    [$clearSelectedObject](): void {
      this[$selectedObject] = null;
      this[$updateModularControls]();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (this.floatingControlsEnabled && this[$selectedObject]) {
        this[$updateModularControls]();
      }
    }

    private [$worldToScreen](position: Vector3): { x: number; y: number } {
      const width = this[$scene].width;
      const height = this[$scene].height;

      const vector = position.clone().project(this[$scene].camera);

      return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (vector.y * -0.5 + 0.5) * height,
      };
    }

    private [$updateModularControls](): void {
      if (!this[$modularControlsContainer] || !this.floatingControlsEnabled) {
        if (this[$modularControlsContainer]) {
          this[$modularControlsContainer].style.display = 'none';
        }
        return;
      }

      if (!this[$selectedObject]) {
        this[$modularControlsContainer].style.display = 'none';
        return;
      }

      // Calculate bounding box center and bottom
      const boundingBox = new Box3().setFromObject(this[$selectedObject]);
      const center = boundingBox.getCenter(new Vector3());

      // Position controls slightly below and in the middle of bounding box
      const controlsPosition = center.clone();
      controlsPosition.y = boundingBox.min.y - 0.2; // 0.2 units below bottom

      // Convert to screen coordinates
      const screenPosition = this[$worldToScreen](controlsPosition);

      // Check if position is visible (in front of camera)
      const vector = controlsPosition.clone().project(this[$scene].camera);
      const isVisible = vector.z < 1;

      if (isVisible) {
        this[$modularControlsContainer].style.display = 'block';
        this[$modularControlsContainer].style.position = 'absolute';
        this[$modularControlsContainer].style.left = `${screenPosition.x}px`;
        this[$modularControlsContainer].style.top = `${screenPosition.y}px`;
        this[$modularControlsContainer].style.transform =
          'translate(-50%, -50%)'; // Center the controls
        this[$modularControlsContainer].style.zIndex = '100';
        this[$modularControlsContainer].style.pointerEvents = 'auto';
      } else {
        this[$modularControlsContainer].style.display = 'none';
      }

      this[$needsRender]();
    }
  }

  return FloatingControlsModelViewerElement as Constructor<FloatingControlsInterface> &
    T;
};

// Type definitions
export interface FloatingControlsInterface {
  floatingControlsEnabled: boolean;
  selectObjectForControls(object: Object3D): void;
  clearSelectedObject(): void;
}
