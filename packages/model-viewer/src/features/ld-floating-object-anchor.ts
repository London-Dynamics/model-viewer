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

import { Vector3, Box3, Sphere, Object3D } from 'three';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
  $tick,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';

const $floatingObjectAnchorSlot = Symbol('floatingObjectAnchorSlot');
const $selectedObject = Symbol('selectedObject');
const $updateFloatingObjectAnchor = Symbol('updateFloatingObjectAnchor');
const $worldToScreen = Symbol('worldToScreen');
const $computeSphereScreenProjection = Symbol('computeSphereScreenProjection');
const $getCachedWorldSphere = Symbol('getCachedWorldSphere');
const $objectAnchorSphereCache = Symbol('objectAnchorSphereCache');
const $formatVector = Symbol('formatVector');

export const $selectObjectForControls = Symbol('selectObjectForControls');
export const $clearSelectedObject = Symbol('clearSelectedObject');

export const LDFloatingObjectAnchorMixin = <
  T extends Constructor<ModelViewerElementBase>,
>(
  ModelViewerElementBase: T
): Constructor<FloatingObjectAnchorInterface> & T => {
  class FloatingObjectAnchorModelViewerElement extends ModelViewerElementBase {
    @property({ type: Boolean, attribute: 'disable-floating-controls' })
    disableFloatingControls: boolean = false;

    private [$floatingObjectAnchorSlot]: HTMLSlotElement | null = null;
    private [$selectedObject]: Object3D | null = null;
    private [$objectAnchorSphereCache] = new WeakMap<
      Object3D,
      { localCenter: Vector3; localRadius: number }
    >();

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$floatingObjectAnchorSlot] = this.shadowRoot?.querySelector(
        'slot[name="floating-object-anchor"]'
      ) as HTMLSlotElement;
    }

    [$selectObjectForControls](object: Object3D): void {
      this[$selectedObject] = object;
      this[$updateFloatingObjectAnchor]();
    }

    [$clearSelectedObject](): void {
      this[$selectedObject] = null;
      this[$updateFloatingObjectAnchor]();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (!this.disableFloatingControls && this[$selectedObject]) {
        this[$updateFloatingObjectAnchor]();
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

    private [$computeSphereScreenProjection](sphere: Sphere): {
      centerX: number;
      centerY: number;
      radiusPx: number;
      isVisible: boolean;
    } {
      const center = sphere.center;
      const projectedCenter = center.clone().project(this[$scene].camera);
      const isVisible = projectedCenter.z < 1;

      const screenCenter = this[$worldToScreen](center);

      const right = new Vector3();
      right.setFromMatrixColumn(this[$scene].camera.matrixWorld, 0);
      const rimPoint = center.clone().addScaledVector(right, sphere.radius);
      const screenRim = this[$worldToScreen](rimPoint);

      const radiusPx = Math.hypot(
        screenRim.x - screenCenter.x,
        screenRim.y - screenCenter.y
      );

      return {
        centerX: screenCenter.x,
        centerY: screenCenter.y,
        radiusPx,
        isVisible,
      };
    }

    private [$getCachedWorldSphere](object: Object3D): Sphere {
      const cached = this[$objectAnchorSphereCache].get(object);
      if (!cached) {
        // Compute once from rendered bounds, then store local-space offset so it
        // remains valid regardless of object placement/orientation in the scene.
        const worldBounds = new Box3().setFromObject(object);
        const worldSphere = worldBounds.getBoundingSphere(new Sphere());

        object.updateMatrixWorld(true);
        const localCenter = object.worldToLocal(worldSphere.center.clone());
        const worldScale = object.getWorldScale(new Vector3());
        const maxScale = Math.max(
          Math.abs(worldScale.x),
          Math.abs(worldScale.y),
          Math.abs(worldScale.z),
          Number.EPSILON
        );
        const localRadius = worldSphere.radius / maxScale;

        const entry = { localCenter, localRadius };
        this[$objectAnchorSphereCache].set(object, entry);
        return worldSphere;
      }

      object.updateMatrixWorld(true);
      const center = object.localToWorld(cached.localCenter.clone());
      const worldScale = object.getWorldScale(new Vector3());
      const maxScale = Math.max(
        Math.abs(worldScale.x),
        Math.abs(worldScale.y),
        Math.abs(worldScale.z),
        Number.EPSILON
      );
      return new Sphere(center, cached.localRadius * maxScale);
    }

    private [$formatVector](vector: Vector3): string {
      return `${vector.x.toFixed(6)} ${vector.y.toFixed(6)} ${vector.z.toFixed(
        6
      )}`;
    }

    private [$updateFloatingObjectAnchor](): void {
      const slot = this[$floatingObjectAnchorSlot];
      if (!slot || this.disableFloatingControls) {
        if (slot) {
          slot.style.display = 'none';
        }
        return;
      }

      if (!this[$selectedObject]) {
        slot.style.display = 'none';
        return;
      }

      slot.dataset.objectName = this[$selectedObject].name || '';
      slot.dataset.objectUuid = this[$selectedObject].uuid || '';

      const assigned = slot.assignedElements({ flatten: true });
      const target = assigned[0] as HTMLElement | undefined;
      if (target) {
        try {
          target.dataset.objectName = this[$selectedObject].name || '';
          target.dataset.objectUuid = this[$selectedObject].uuid || '';
        } catch (_e) {
          // Leave attributes on the slot as a fallback.
        }
      }

      const worldSphere = this[$getCachedWorldSphere](this[$selectedObject]);
      const projection = this[$computeSphereScreenProjection](worldSphere);
      const cachedSphere = this[$objectAnchorSphereCache].get(
        this[$selectedObject]
      );
      const localOffsetText = cachedSphere
        ? this[$formatVector](cachedSphere.localCenter)
        : '0 0 0';

      if (projection.isVisible) {
        const radiusPx = Math.round(projection.radiusPx);
        slot.style.display = 'block';
        slot.style.position = 'absolute';
        slot.style.left = `${projection.centerX}px`;
        slot.style.top = `${projection.centerY}px`;
        slot.style.transform = 'translate(-50%, -50%)';
        slot.style.zIndex = '100';
        slot.style.pointerEvents = 'auto';
        slot.dataset.sphereRadiusPx = String(radiusPx);
        slot.dataset.sphereCenterOffsetLocal = localOffsetText;

        if (target) {
          try {
            target.dataset.sphereRadiusPx = String(radiusPx);
            target.dataset.sphereCenterOffsetLocal = localOffsetText;
          } catch (_e) {
            // Leave attributes on the slot as a fallback.
          }
        }
      } else {
        slot.style.display = 'none';
      }

      this[$needsRender]();
    }
  }

  return FloatingObjectAnchorModelViewerElement as Constructor<FloatingObjectAnchorInterface> &
    T;
};

export interface FloatingObjectAnchorInterface {
  floatingControlsEnabled: boolean;
  selectObjectForControls(object: Object3D): void;
  clearSelectedObject(): void;
}
