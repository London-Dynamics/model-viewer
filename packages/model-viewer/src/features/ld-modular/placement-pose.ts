import {Box3, Object3D, Vector3} from 'three';
import {
  getPrimarySurfaceSnapPoint,
  getSnappingPointWorldPosition,
  requiresSurfaceSnap,
} from '../../utilities/snapping-points.js';
import {getObjectBottomCenterWorld} from './clipboard.js';
import {getMouseWorldPointOnPlacementPlane} from '../../utilities/mouse-world-point.js';
import type {SurfaceSnapHit} from '../../utilities/surface-snapping.js';
import {$scene} from '../../model-viewer-base.js';

export type PlacementPoseResult = {
  worldPoint: Vector3 | null;
  cursorWorld: Vector3 | null;
  targetBottomCenter: Vector3 | null;
  hasValidSurfaceSnap: boolean;
  surfaceHit: SurfaceSnapHit | null;
};

export type PlacementPoseHost = {
  getBoundingClientRect(): DOMRect;
  [$scene]: Object3D & {target?: Object3D};
  applySurfaceSnapForPlacement?(
    object: Object3D,
    clientX: number,
    clientY: number
  ): SurfaceSnapHit | null;
  _getCursorWorldPosition?(): {x: number; y: number; z: number} | null;
  _updateCursorFromPointer?(clientX: number, clientY: number): void;
};

/**
 * Positions a movable object at the pointer using the same bottom-center and
 * surface-snap rules as interactive placement.
 */
export function applyPointerPlacementPose(
  host: PlacementPoseHost,
  object: Object3D,
  clientX: number,
  clientY: number,
  options?: {updateCursor?: boolean}
): PlacementPoseResult {
  if (options?.updateCursor !== false) {
    host._updateCursorFromPointer?.(clientX, clientY);
  }

  const scene = host[$scene];
  const world = getMouseWorldPointOnPlacementPlane(
    host as unknown as HTMLElement,
    scene as Parameters<typeof getMouseWorldPointOnPlacementPlane>[1],
    clientX,
    clientY
  );

  if (!world) {
    return {
      worldPoint: null,
      cursorWorld: null,
      targetBottomCenter: null,
      hasValidSurfaceSnap: false,
      surfaceHit: null,
    };
  }

  const cursorPos = host._getCursorWorldPosition?.();
  const cursorWorld = cursorPos
    ? new Vector3(cursorPos.x, cursorPos.y, cursorPos.z)
    : world.clone();

  let hasValidSurfaceSnap = !requiresSurfaceSnap(object);
  let surfaceHit: SurfaceSnapHit | null = null;
  let targetBottomCenter = cursorWorld.clone();

  const parent = object.parent;
  const originalPos = object.position.clone();
  const originalQuat = object.quaternion.clone();
  const originalScale = object.scale.clone();

  if (parent) {
    parent.remove(object);
  }
  object.position.set(0, 0, 0);
  object.quaternion.set(0, 0, 0, 1);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const bboxLocal = new Box3().setFromObject(object);
  let bottomCenterLocal: Vector3;
  if (
    Number.isFinite(bboxLocal.min.x) &&
    Number.isFinite(bboxLocal.max.x) &&
    Number.isFinite(bboxLocal.min.y) &&
    Number.isFinite(bboxLocal.min.z) &&
    Number.isFinite(bboxLocal.max.z)
  ) {
    bottomCenterLocal = new Vector3(
      (bboxLocal.min.x + bboxLocal.max.x) / 2,
      bboxLocal.min.y,
      (bboxLocal.min.z + bboxLocal.max.z) / 2
    );
  } else {
    bottomCenterLocal = new Vector3(0, 0, 0);
  }

  if (parent) {
    parent.add(object);
  }
  object.position.copy(originalPos);
  object.quaternion.copy(originalQuat);
  object.scale.copy(originalScale);

  const target = scene?.target;
  if (target) {
    target.updateMatrixWorld(true);
  }
  const targetWorldPos = new Vector3();
  if (target) {
    target.getWorldPosition(targetWorldPos);
  }

  const objectLocalPos = new Vector3()
    .subVectors(cursorWorld, targetWorldPos)
    .sub(bottomCenterLocal);
  object.position.copy(objectLocalPos);

  if (requiresSurfaceSnap(object) && host.applySurfaceSnapForPlacement) {
    surfaceHit = host.applySurfaceSnapForPlacement(object, clientX, clientY);
    hasValidSurfaceSnap = !!surfaceHit;
    if (surfaceHit) {
      const wallPoint = getWallCursorPointFromObject(object, surfaceHit);
      if (wallPoint) {
        targetBottomCenter = wallPoint;
      } else {
        const snapPoint = getPrimarySurfaceSnapPoint(object);
        if (snapPoint) {
          targetBottomCenter = getSnappingPointWorldPosition(object, snapPoint);
        }
      }
    }
  }

  return {
    worldPoint: world,
    cursorWorld,
    targetBottomCenter,
    hasValidSurfaceSnap,
    surfaceHit,
  };
}

export type SelectionPlacementItem = {
  object: Object3D;
  requiresSurfaceSnap: boolean;
  anchorOffset: Vector3;
};

export type SelectionPlacementResult = PlacementPoseResult & {
  itemValidSnap: boolean[];
};

function positionObjectBottomCenterAtWorld(
  object: Object3D,
  worldBottomCenter: Vector3
): void {
  object.updateMatrixWorld(true);
  const current = getObjectBottomCenterWorld(object);
  const delta = worldBottomCenter.clone().sub(current);
  const worldPos = new Vector3();
  object.getWorldPosition(worldPos);
  worldPos.add(delta);

  const parent = object.parent;
  if (parent) {
    parent.updateMatrixWorld(true);
    object.position.copy(parent.worldToLocal(worldPos));
  } else {
    object.position.copy(worldPos);
  }
  object.updateMatrixWorld(true);
}

/**
 * Positions multiple clipboard ghosts together: the leader follows the pointer,
 * followers keep their copied offsets and run their own surface snap checks.
 */
export function applySelectionPointerPlacementPose(
  host: PlacementPoseHost,
  leader: Object3D,
  items: SelectionPlacementItem[],
  clientX: number,
  clientY: number,
  options?: {updateCursor?: boolean}
): SelectionPlacementResult {
  const leaderResult = applyPointerPlacementPose(
    host,
    leader,
    clientX,
    clientY,
    options
  );

  if (!leaderResult.worldPoint) {
    for (const item of items) {
      if (item.object !== leader) {
        try {
          item.object.visible = false;
        } catch (_e) {}
      }
    }
    return {
      ...leaderResult,
      itemValidSnap: items.map(() => false),
    };
  }

  const leaderBottom = getObjectBottomCenterWorld(leader);
  const itemValidSnap: boolean[] = [];

  for (const item of items) {
    const isLeader = item.object === leader;
    if (!isLeader) {
      positionObjectBottomCenterAtWorld(
        item.object,
        leaderBottom.clone().add(item.anchorOffset)
      );
      try {
        item.object.visible = true;
      } catch (_e) {}
    }

    let valid = !item.requiresSurfaceSnap;
    if (item.requiresSurfaceSnap && host.applySurfaceSnapForPlacement) {
      const hit = host.applySurfaceSnapForPlacement(
        item.object,
        clientX,
        clientY
      );
      valid = !!hit;
    } else if (isLeader) {
      valid = leaderResult.hasValidSurfaceSnap;
    }
    itemValidSnap.push(valid);
  }

  const hasValidSurfaceSnap = itemValidSnap.every(
    (valid, index) => !items[index].requiresSurfaceSnap || valid
  );

  return {
    ...leaderResult,
    hasValidSurfaceSnap,
    itemValidSnap,
  };
}

function getWallCursorPointFromObject(
  object: Object3D,
  surfaceHit: SurfaceSnapHit
): Vector3 | null {
  const bbox = new Box3().setFromObject(object);
  if (
    !Number.isFinite(bbox.min.x) ||
    !Number.isFinite(bbox.min.y) ||
    !Number.isFinite(bbox.min.z) ||
    !Number.isFinite(bbox.max.x) ||
    !Number.isFinite(bbox.max.y) ||
    !Number.isFinite(bbox.max.z)
  ) {
    return null;
  }

  const center = bbox.getCenter(new Vector3());
  const halfSize = bbox.getSize(new Vector3()).multiplyScalar(0.5);
  const normal = surfaceHit.normal.clone().normalize();
  const projectedHalfDepth =
    Math.abs(normal.x) * halfSize.x +
    Math.abs(normal.y) * halfSize.y +
    Math.abs(normal.z) * halfSize.z;

  return center.addScaledVector(normal, -projectedHalfDepth);
}
