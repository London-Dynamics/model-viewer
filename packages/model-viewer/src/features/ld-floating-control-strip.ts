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
const $computeScreenRectFromBox = Symbol('computeScreenRectFromBox');
const $getFloatingControlsSize = Symbol('getFloatingControlsSize');
const $pickControlScreenPosition = Symbol('pickControlScreenPosition');

export const $selectObjectForControls = Symbol('selectObjectForControls');
export const $clearSelectedObject = Symbol('clearSelectedObject');

// Mixin that adds floating controls functionality
export const LDFloatingControlStripMixin = <
  T extends Constructor<ModelViewerElementBase>,
>(
  ModelViewerElementBase: T
): Constructor<FloatingControlStripInterface> & T => {
  class FloatingControlStripModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'disable-floating-controls' })
    disableFloatingControls: boolean = false;

    private [$modularControlsContainer]: HTMLSlotElement | null = null;
    private [$selectedObject]: Object3D | null = null;

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$modularControlsContainer] = this.shadowRoot?.querySelector(
        'slot[name="floating-control-strip"]'
      ) as HTMLSlotElement;
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

      if (!this.disableFloatingControls && this[$selectedObject]) {
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

    private [$computeScreenRectFromBox](boundingBox: Box3): {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      centerX: number;
      centerY: number;
      isVisible: boolean;
    } {
      const corners = [
        new Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
        new Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.max.z),
        new Vector3(boundingBox.min.x, boundingBox.max.y, boundingBox.min.z),
        new Vector3(boundingBox.min.x, boundingBox.max.y, boundingBox.max.z),
        new Vector3(boundingBox.max.x, boundingBox.min.y, boundingBox.min.z),
        new Vector3(boundingBox.max.x, boundingBox.min.y, boundingBox.max.z),
        new Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.min.z),
        new Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
      ];

      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let hasVisibleCorner = false;

      for (const corner of corners) {
        const projected = corner.clone().project(this[$scene].camera);
        if (projected.z < 1) {
          hasVisibleCorner = true;
        }

        const screenPos = this[$worldToScreen](corner);
        minX = Math.min(minX, screenPos.x);
        maxX = Math.max(maxX, screenPos.x);
        minY = Math.min(minY, screenPos.y);
        maxY = Math.max(maxY, screenPos.y);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        const fallbackCenter = this[$worldToScreen](
          boundingBox.getCenter(new Vector3())
        );
        return {
          minX: fallbackCenter.x,
          maxX: fallbackCenter.x,
          minY: fallbackCenter.y,
          maxY: fallbackCenter.y,
          centerX: fallbackCenter.x,
          centerY: fallbackCenter.y,
          isVisible: false,
        };
      }

      return {
        minX,
        maxX,
        minY,
        maxY,
        centerX: (minX + maxX) * 0.5,
        centerY: (minY + maxY) * 0.5,
        isVisible: hasVisibleCorner,
      };
    }

    private [$getFloatingControlsSize](): { width: number; height: number } {
      const slot = this[$modularControlsContainer] as HTMLSlotElement | null;
      const fallback = { width: 160, height: 48 };

      if (!slot) {
        return fallback;
      }

      const assigned = slot.assignedElements({ flatten: true });
      const target = assigned[0] as HTMLElement | undefined;
      if (!target) {
        return fallback;
      }

      const width = target.offsetWidth || target.clientWidth || fallback.width;
      const height = target.offsetHeight || target.clientHeight || fallback.height;
      return { width, height };
    }

    private [$pickControlScreenPosition](boundingBox: Box3): {
      x: number;
      y: number;
      isVisible: boolean;
    } {
      const width = this[$scene].width;
      const height = this[$scene].height;
      const screenRect = this[$computeScreenRectFromBox](boundingBox);
      const controlsSize = this[$getFloatingControlsSize]();
      const viewportPadding = 8;
      const objectPadding = 16;
      const halfW = controlsSize.width * 0.5;
      const halfH = controlsSize.height * 0.5;
      const minAllowedX = viewportPadding + halfW;
      const maxAllowedX = width - viewportPadding - halfW;
      const minAllowedY = viewportPadding + halfH;
      const maxAllowedY = height - viewportPadding - halfH;

      const cameraDirection = this[$scene].camera
        .getWorldDirection(new Vector3())
        .normalize();
      const isTopOrBottomView = Math.abs(cameraDirection.y) > 0.65;

      const candidates = [
        {
          key: 'below',
          x: screenRect.centerX,
          y: screenRect.maxY + objectPadding + halfH,
        },
        {
          key: 'above',
          x: screenRect.centerX,
          y: screenRect.minY - objectPadding - halfH,
        },
        {
          key: 'right',
          x: screenRect.maxX + objectPadding + halfW,
          y: screenRect.centerY,
        },
        {
          key: 'left',
          x: screenRect.minX - objectPadding - halfW,
          y: screenRect.centerY,
        },
      ];

      const priority = isTopOrBottomView
        ? ['right', 'left', 'above', 'below']
        : ['below', 'above', 'right', 'left'];

      for (const key of priority) {
        const candidate = candidates.find((c) => c.key === key);
        if (!candidate) {
          continue;
        }

        const fitsViewport =
          candidate.x >= minAllowedX &&
          candidate.x <= maxAllowedX &&
          candidate.y >= minAllowedY &&
          candidate.y <= maxAllowedY;

        if (fitsViewport) {
          return {
            x: candidate.x,
            y: candidate.y,
            isVisible: screenRect.isVisible,
          };
        }
      }

      // Fall back to clamped "below" position if no ideal candidate fits.
      const below = candidates[0];
      const clampedX = Math.min(maxAllowedX, Math.max(minAllowedX, below.x));
      const clampedY = Math.min(maxAllowedY, Math.max(minAllowedY, below.y));

      return {
        x: clampedX,
        y: clampedY,
        isVisible: screenRect.isVisible,
      };
    }

    private [$updateModularControls](): void {
      if (!this[$modularControlsContainer] || this.disableFloatingControls) {
        if (this[$modularControlsContainer]) {
          this[$modularControlsContainer].style.display = 'none';
        }
        return;
      }

      if (!this[$selectedObject]) {
        this[$modularControlsContainer].style.display = 'none';
        return;
      }

      // Set dataset both on the slot and (preferably) on the assigned child
      // so that the slotted element can read the data attributes directly.
      const slot = this[$modularControlsContainer] as HTMLSlotElement;
      if (slot) {
        // Keep compatibility by setting on the slot itself
        slot.dataset.objectName = this[$selectedObject].name || '';
        slot.dataset.objectUuid = this[$selectedObject].uuid || '';

        // Prefer setting on the first assigned element so the light-DOM
        // child receives the attributes directly.
        const assigned = slot.assignedElements({ flatten: true });
        if (assigned && assigned.length > 0) {
          const target = assigned[0] as HTMLElement;
          try {
            target.dataset.objectName = this[$selectedObject].name || '';
            target.dataset.objectUuid = this[$selectedObject].uuid || '';
          } catch (e) {
            // If for some reason we can't set dataset on the assigned element,
            // leave the attributes on the slot as a fallback.
          }
        }
      }

      // Calculate object bounds once and place controls in screen space.
      const boundingBox = new Box3().setFromObject(this[$selectedObject]);
      const screenPosition = this[$pickControlScreenPosition](boundingBox);
      const isVisible = screenPosition.isVisible;

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
        console.log(
          '[FloatingControlStrip] Controls not visible (behind camera)'
        );
        this[$modularControlsContainer].style.display = 'none';
      }

      this[$needsRender]();
    }
  }

  return FloatingControlStripModelViewerElement as Constructor<FloatingControlStripInterface> &
    T;
};

// Type definitions
export interface FloatingControlStripInterface {
  floatingControlsEnabled: boolean;
  selectObjectForControls(object: Object3D): void;
  clearSelectedObject(): void;
}
