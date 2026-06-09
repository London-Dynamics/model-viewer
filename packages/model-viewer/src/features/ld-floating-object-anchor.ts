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

import { Vector3, Box3, Sphere, Object3D, Camera } from 'three';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
  $tick,
} from '../model-viewer-base.js';
import { Constructor } from '../utilities.js';
import { getObjectDisplayName } from './ld-modular/transform-events.js';

/** Scales the AABB-derived bounding sphere radius used for anchor placement. */
const ANCHOR_SPHERE_RADIUS_MULTIPLIER = 0.9;

const $floatingObjectAnchorSlot = Symbol('floatingObjectAnchorSlot');
const $selectedObject = Symbol('selectedObject');
const $updateFloatingObjectAnchor = Symbol('updateFloatingObjectAnchor');
const $objectAnchorSphereCache = Symbol('objectAnchorSphereCache');
const $formatVector = Symbol('formatVector');

export const $selectObjectForControls = Symbol('selectObjectForControls');
export const $clearSelectedObject = Symbol('clearSelectedObject');

/**
 * Placeholder for multi-select anchor bounds (not wired up yet).
 *
 * When several objects are selected, the anchor center should sit at the centroid
 * of the selection. The radius should be the shortest semi-axis of an ovoid fitted
 * around that selection — not the radius of one large sphere that encloses every
 * object.
 */
export function computeMultiSelectionAnchorSphere(
  _objects: readonly Object3D[]
): Sphere {
  return new Sphere(new Vector3(), 0);
}

export type ObjectAnchorSphereCacheEntry = {
  localCenter: Vector3;
  localRadius: number;
};

export type ObjectAnchorScreenProjection = {
  centerX: number;
  centerY: number;
  radiusPx: number;
  isVisible: boolean;
};

type AnchorProjectionInput = {
  object: Object3D;
  camera: Camera;
  viewportWidth: number;
  viewportHeight: number;
  sphereCache: WeakMap<Object3D, ObjectAnchorSphereCacheEntry>;
};

export function getObjectAnchorScreenProjection({
  object,
  camera,
  viewportWidth,
  viewportHeight,
  sphereCache,
}: AnchorProjectionInput): {
  projection: ObjectAnchorScreenProjection;
  localCenter: Vector3;
} {
  const cached = sphereCache.get(object);
  let worldSphere: Sphere;
  let localCenter: Vector3;

  if (!cached) {
    const worldBounds = new Box3().setFromObject(object);
    const baseWorldSphere = worldBounds.getBoundingSphere(new Sphere());
    object.updateMatrixWorld(true);
    localCenter = object.worldToLocal(baseWorldSphere.center.clone());
    const worldScale = object.getWorldScale(new Vector3());
    const maxScale = Math.max(
      Math.abs(worldScale.x),
      Math.abs(worldScale.y),
      Math.abs(worldScale.z),
      Number.EPSILON
    );
    const localRadius =
      (baseWorldSphere.radius / maxScale) * ANCHOR_SPHERE_RADIUS_MULTIPLIER;
    sphereCache.set(object, { localCenter, localRadius });
    worldSphere = new Sphere(
      baseWorldSphere.center,
      baseWorldSphere.radius * ANCHOR_SPHERE_RADIUS_MULTIPLIER
    );
  } else {
    object.updateMatrixWorld(true);
    localCenter = cached.localCenter;
    const center = object.localToWorld(cached.localCenter.clone());
    const worldScale = object.getWorldScale(new Vector3());
    const maxScale = Math.max(
      Math.abs(worldScale.x),
      Math.abs(worldScale.y),
      Math.abs(worldScale.z),
      Number.EPSILON
    );
    worldSphere = new Sphere(center, cached.localRadius * maxScale);
  }

  const center = worldSphere.center;
  const projectedCenter = center.clone().project(camera);
  const isVisible = projectedCenter.z < 1;
  const toScreen = (position: Vector3): { x: number; y: number } => {
    const vector = position.clone().project(camera);
    return {
      x: (vector.x * 0.5 + 0.5) * viewportWidth,
      y: (vector.y * -0.5 + 0.5) * viewportHeight,
    };
  };
  const screenCenter = toScreen(center);
  const right = new Vector3();
  right.setFromMatrixColumn((camera as any).matrixWorld, 0);
  const rimPoint = center.clone().addScaledVector(right, worldSphere.radius);
  const screenRim = toScreen(rimPoint);

  return {
    projection: {
      centerX: screenCenter.x,
      centerY: screenCenter.y,
      radiusPx: Math.hypot(screenRim.x - screenCenter.x, screenRim.y - screenCenter.y),
      isVisible,
    },
    localCenter,
  };
}

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
      ObjectAnchorSphereCacheEntry
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

      const selectedObject = this[$selectedObject];
      const objectName = selectedObject.name || '';
      const displayName = getObjectDisplayName(selectedObject);
      slot.dataset.objectName = objectName;
      slot.dataset.objectUuid = selectedObject.uuid || '';
      if (displayName !== objectName) {
        slot.dataset.displayName = displayName;
      } else {
        delete slot.dataset.displayName;
      }

      const assigned = slot.assignedElements({ flatten: true });
      const target = assigned[0] as HTMLElement | undefined;
      if (target) {
        try {
          target.dataset.objectName = objectName;
          target.dataset.objectUuid = selectedObject.uuid || '';
          if (displayName !== objectName) {
            target.dataset.displayName = displayName;
          } else {
            delete target.dataset.displayName;
          }
        } catch (_e) {
          // Leave attributes on the slot as a fallback.
        }
      }

      // TODO(multi-select): use computeMultiSelectionAnchorSphere when more than
      // one object is selected.
      const { projection, localCenter } = getObjectAnchorScreenProjection({
        object: this[$selectedObject],
        camera: this[$scene].camera,
        viewportWidth: this[$scene].width,
        viewportHeight: this[$scene].height,
        sphereCache: this[$objectAnchorSphereCache],
      });
      const localOffsetText = this[$formatVector](localCenter);

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
  disableFloatingControls: boolean;
  selectObjectForControls(object: Object3D): void;
  clearSelectedObject(): void;
}
