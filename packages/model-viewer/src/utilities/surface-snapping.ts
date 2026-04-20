import {
  Box3,
  Camera,
  Matrix4,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { SnapPoint } from '@london-dynamics/types/planner';
import {
  allowsSurfaceType,
  getMaxFromFloorConstraint,
  getMinFromFloorConstraint,
  getSurfaceSnapOffset,
  type SurfaceType,
} from './snapping-points.js';

const WORLD_UP = new Vector3(0, 1, 0);
const LOCAL_FORWARD = new Vector3(0, 0, 1);
const EPSILON = 1e-6;
const AXES: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

export type SurfaceSnapHit = {
  point: Vector3;
  normal: Vector3;
  surfaceType: SurfaceType;
  object: Object3D;
};

type ClearanceRange = {
  min?: number;
  max?: number;
};

type AxisDistanceContext = {
  localValue: number;
  min: number;
  max: number;
};

const LOCAL_AXIS_X = new Vector3(1, 0, 0);
const LOCAL_AXIS_Y = new Vector3(0, 1, 0);
const LOCAL_AXIS_Z = new Vector3(0, 0, 1);
const OBJECT_LOCAL_BOUNDS_CACHE = new WeakMap<Object3D, Box3>();
const TMP_ROOT_INV = new Matrix4();
const TMP_CHILD_TO_OBJECT = new Matrix4();

function getSnapPointLocalPosition(snapPoint: SnapPoint): Vector3 {
  const pos = snapPoint.transform?.position ?? [0, 0, 0];
  return new Vector3(pos[0], pos[1], pos[2]);
}

function getSurfaceTypeFromMetadata(object: Object3D): SurfaceType | null {
  const objectName = (object.name || '').toLowerCase();
  if (objectName.startsWith('wall_')) return 'wall';
  if (objectName.startsWith('floor_')) return 'floor';
  if (objectName.startsWith('ceiling_')) return 'ceiling';

  const labels: string[] = [];
  if (objectName) labels.push(objectName);

  const userDataSurfaceType = (object.userData as any)?.surfaceType;
  if (typeof userDataSurfaceType === 'string') {
    labels.push(userDataSurfaceType.toLowerCase());
  }

  const materialName = (object as any)?.material?.name;
  if (typeof materialName === 'string' && materialName.length > 0) {
    labels.push(materialName.toLowerCase());
  }

  if (labels.some((label) => label.includes('wall'))) return 'wall';
  if (labels.some((label) => label.includes('ceiling'))) return 'ceiling';
  if (labels.some((label) => label.includes('floor'))) return 'floor';
  return null;
}

export function classifySurfaceType(
  hitObject: Object3D,
  worldNormal: Vector3
): SurfaceType {
  const metadataType = getSurfaceTypeFromMetadata(hitObject);
  if (metadataType) return metadataType;

  const y = worldNormal.y;
  const absY = Math.abs(y);
  if (absY < 0.6) return 'wall';
  return y >= 0 ? 'floor' : 'ceiling';
}

export function getBaseModelObject(sceneRoot: Object3D): Object3D | null {
  let baseModel: Object3D | null = null;
  sceneRoot.traverse((child) => {
    if (!baseModel && child.userData?.isBaseModel) {
      baseModel = child;
    }
  });
  return baseModel;
}

export function getRoomFloorY(baseModel: Object3D | null): number | null {
  if (!baseModel) return null;
  const bbox = new Box3().setFromObject(baseModel);
  if (!Number.isFinite(bbox.min.y)) return null;
  return bbox.min.y;
}

export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: DOMRect
): Vector2 | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  return new Vector2(ndcX, ndcY);
}

export function findSurfaceSnapHitForNdc(
  camera: Camera,
  ndc: Vector2,
  roomObject: Object3D,
  snapPoint: SnapPoint,
  snappedObject: Object3D
): SurfaceSnapHit | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const intersections = raycaster.intersectObject(roomObject, true);

  for (const intersection of intersections) {
    if (!intersection.face) continue;
    const worldNormal = intersection.face.normal
      .clone()
      .transformDirection(intersection.object.matrixWorld)
      .normalize();
    const surfaceType = classifySurfaceType(intersection.object, worldNormal);
    if (!allowsSurfaceType(snapPoint, surfaceType)) continue;
    if (
      !passesEdgeClearance(
        snapPoint,
        intersection.object,
        intersection.point,
        worldNormal,
        snappedObject
      )
    )
      continue;
    return {
      point: intersection.point.clone(),
      normal: worldNormal,
      surfaceType,
      object: intersection.object,
    };
  }

  return null;
}

function getGeometryBounds(object: Object3D): Box3 | null {
  const geometry = (object as any)?.geometry;
  if (!geometry) return null;
  if (!geometry.boundingBox) {
    try {
      geometry.computeBoundingBox();
    } catch (e) {
      return null;
    }
  }
  const bbox = geometry.boundingBox as Box3 | null;
  return bbox ? bbox.clone() : null;
}

function getLocalSurfaceNormal(object: Object3D, worldNormal: Vector3): Vector3 {
  const worldQuat = new Quaternion();
  object.getWorldQuaternion(worldQuat);
  return worldNormal.clone().applyQuaternion(worldQuat.clone().invert()).normalize();
}

function getHorizontalAxis(
  object: Object3D,
  worldNormal: Vector3,
  bounds: Box3
): 'x' | 'y' | 'z' {
  const localNormal = getLocalSurfaceNormal(object, worldNormal);
  let depthAxis: 'x' | 'y' | 'z' = 'z';
  let maxAbs = Math.abs(localNormal.z);
  if (Math.abs(localNormal.x) > maxAbs) {
    depthAxis = 'x';
    maxAbs = Math.abs(localNormal.x);
  }
  if (Math.abs(localNormal.y) > maxAbs) {
    depthAxis = 'y';
  }

  const candidates = AXES.filter((axis) => axis !== depthAxis && axis !== 'y');
  const fallbackCandidates =
    candidates.length > 0 ? candidates : AXES.filter((axis) => axis !== depthAxis);
  let chosen = fallbackCandidates[0] || 'x';
  let bestSize = -Infinity;
  fallbackCandidates.forEach((axis) => {
    const size = bounds.max[axis] - bounds.min[axis];
    if (size > bestSize) {
      bestSize = size;
      chosen = axis;
    }
  });
  return chosen;
}

function getAxisDistanceContext(
  localPoint: Vector3,
  bounds: Box3,
  axis: 'x' | 'y' | 'z'
): AxisDistanceContext {
  return {
    localValue: localPoint[axis],
    min: bounds.min[axis],
    max: bounds.max[axis],
  };
}

function passesRangeClearance(
  range: ClearanceRange | undefined,
  context: AxisDistanceContext,
  objectInset: number
): boolean {
  if (!range) return true;
  const distToMin = context.localValue - context.min;
  const distToMax = context.max - context.localValue;
  const nearestEdgeDistance = Math.min(distToMin, distToMax);

  if (
    typeof range.min === 'number' &&
    Number.isFinite(range.min) &&
    nearestEdgeDistance < range.min + objectInset
  ) {
    return false;
  }
  if (
    typeof range.max === 'number' &&
    Number.isFinite(range.max) &&
    nearestEdgeDistance > range.max + objectInset
  ) {
    return false;
  }
  return true;
}

function getObjectLocalBounds(object: Object3D): Box3 | null {
  const cached = OBJECT_LOCAL_BOUNDS_CACHE.get(object);
  if (cached) return cached;

  let hasBounds = false;
  const out = new Box3();
  try {
    object.updateMatrixWorld(true);
    TMP_ROOT_INV.copy(object.matrixWorld).invert();

    object.traverse((child) => {
      if (!(child as any).isMesh) return;
      const geometry = (child as any).geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) {
        try {
          geometry.computeBoundingBox();
        } catch (e) {
          return;
        }
      }
      const childBounds = geometry.boundingBox as Box3 | null;
      if (!childBounds) return;

      TMP_CHILD_TO_OBJECT.multiplyMatrices(TMP_ROOT_INV, child.matrixWorld);
      const transformed = childBounds.clone().applyMatrix4(TMP_CHILD_TO_OBJECT);
      if (!hasBounds) {
        out.copy(transformed);
        hasBounds = true;
      } else {
        out.union(transformed);
      }
    });
  } catch (e) {
    return null;
  }

  if (!hasBounds || !Number.isFinite(out.min.x) || !Number.isFinite(out.max.x)) {
    return null;
  }

  const finalBounds = out.clone();
  OBJECT_LOCAL_BOUNDS_CACHE.set(object, finalBounds);
  return finalBounds;
}

function getWallAxisUnit(axis: 'x' | 'y' | 'z'): Vector3 {
  if (axis === 'x') return LOCAL_AXIS_X;
  if (axis === 'y') return LOCAL_AXIS_Y;
  return LOCAL_AXIS_Z;
}

function getInsetForWallAxis(
  wallAxisUnit: Vector3,
  wallAxisInObjectX: Vector3,
  wallAxisInObjectY: Vector3,
  wallAxisInObjectZ: Vector3,
  halfX: number,
  halfY: number,
  halfZ: number
): number {
  const inset =
    Math.abs(wallAxisUnit.dot(wallAxisInObjectX)) * halfX +
    Math.abs(wallAxisUnit.dot(wallAxisInObjectY)) * halfY +
    Math.abs(wallAxisUnit.dot(wallAxisInObjectZ)) * halfZ;
  return Number.isFinite(inset) ? inset : 0;
}

function getAxisInsetsFromObjectEdge(
  object: Object3D,
  snapPoint: SnapPoint,
  hitObject: Object3D,
  worldNormal: Vector3,
  horizontalAxis: 'x' | 'y' | 'z',
  verticalAxis: 'x' | 'y' | 'z'
): { horizontalInset: number; verticalInset: number } {
  const bounds = getObjectLocalBounds(object);
  if (!bounds) {
    return { horizontalInset: 0, verticalInset: 0 };
  }

  const desiredForward = getDesiredForward(snapPoint, worldNormal);
  const worldQuaternion = getDesiredQuaternion(
    snapPoint,
    desiredForward,
    object.quaternion
  );

  const wallWorldQuat = new Quaternion();
  hitObject.getWorldQuaternion(wallWorldQuat);
  const objectToWallQuat = wallWorldQuat.clone().invert().multiply(worldQuaternion);

  const wallAxisInObjectX = LOCAL_AXIS_X.clone().applyQuaternion(objectToWallQuat);
  const wallAxisInObjectY = LOCAL_AXIS_Y.clone().applyQuaternion(objectToWallQuat);
  const wallAxisInObjectZ = LOCAL_AXIS_Z.clone().applyQuaternion(objectToWallQuat);

  const halfX = ((bounds.max.x - bounds.min.x) * Math.abs(object.scale.x)) / 2;
  const halfY = ((bounds.max.y - bounds.min.y) * Math.abs(object.scale.y)) / 2;
  const halfZ = ((bounds.max.z - bounds.min.z) * Math.abs(object.scale.z)) / 2;

  return {
    horizontalInset: getInsetForWallAxis(
      getWallAxisUnit(horizontalAxis),
      wallAxisInObjectX,
      wallAxisInObjectY,
      wallAxisInObjectZ,
      halfX,
      halfY,
      halfZ
    ),
    verticalInset: getInsetForWallAxis(
      getWallAxisUnit(verticalAxis),
      wallAxisInObjectX,
      wallAxisInObjectY,
      wallAxisInObjectZ,
      halfX,
      halfY,
      halfZ
    ),
  };
}

function passesEdgeClearance(
  snapPoint: SnapPoint,
  hitObject: Object3D,
  worldPoint: Vector3,
  worldNormal: Vector3,
  snappedObject: Object3D
): boolean {
  const edgeClearance = (snapPoint as any)?.surfaceSnap?.edgeClearance;
  if (!edgeClearance) return true;

  const bounds = getGeometryBounds(hitObject);
  if (!bounds) return true;

  const localPoint = hitObject.worldToLocal(worldPoint.clone());
  const horizontalAxis = getHorizontalAxis(hitObject, worldNormal, bounds);
  const verticalAxis: 'x' | 'y' | 'z' = 'y';

  const horizontalContext = getAxisDistanceContext(localPoint, bounds, horizontalAxis);
  const verticalContext = getAxisDistanceContext(localPoint, bounds, verticalAxis);
  const { horizontalInset, verticalInset } = getAxisInsetsFromObjectEdge(
    snappedObject,
    snapPoint,
    hitObject,
    worldNormal,
    horizontalAxis,
    verticalAxis
  );

  return (
    passesRangeClearance(edgeClearance.horizontal, horizontalContext, horizontalInset) &&
    passesRangeClearance(edgeClearance.vertical, verticalContext, verticalInset)
  );
}

function getDesiredForward(
  snapPoint: SnapPoint,
  surfaceNormal: Vector3
): Vector3 {
  const normalMode = (snapPoint as any)?.surfaceSnap?.normal ?? 'outward';
  const normal = surfaceNormal.clone().normalize();

  switch (normalMode) {
    case 'inward':
    case 'outward':
      // "inward/outward" determines which side of the wall to place on.
      // It should not flip facing direction.
      return normal;
    case 'up':
      return WORLD_UP.clone();
    case 'down':
      return WORLD_UP.clone().multiplyScalar(-1);
    default:
      return normal;
  }
}

function getSurfaceOffsetDirection(
  snapPoint: SnapPoint,
  surfaceNormal: Vector3
): Vector3 {
  const normalMode = (snapPoint as any)?.surfaceSnap?.normal ?? 'outward';
  const normal = surfaceNormal.clone().normalize();

  if (normalMode === 'inward') {
    return normal.multiplyScalar(-1);
  }
  if (normalMode === 'down') {
    return WORLD_UP.clone().multiplyScalar(-1);
  }
  if (normalMode === 'up') {
    return WORLD_UP.clone();
  }
  return normal;
}

function getDesiredQuaternion(
  snapPoint: SnapPoint,
  desiredForward: Vector3,
  fallbackQuaternion: Quaternion
): Quaternion {
  const alignMode = (snapPoint as any)?.surfaceSnap?.align ?? 'keep-upright';
  const safeForward = desiredForward.clone().normalize();
  if (safeForward.lengthSq() < EPSILON) {
    return fallbackQuaternion.clone();
  }

  if (alignMode === 'keep-upright') {
    const planarForward = new Vector3(safeForward.x, 0, safeForward.z);
    if (planarForward.lengthSq() < EPSILON) {
      return fallbackQuaternion.clone();
    }
    planarForward.normalize();
    const yaw = Math.atan2(planarForward.x, planarForward.z);
    return new Quaternion().setFromAxisAngle(WORLD_UP, yaw);
  }

  return new Quaternion().setFromUnitVectors(LOCAL_FORWARD, safeForward);
}

function clampToVerticalConstraint(
  object: Object3D,
  snapPoint: SnapPoint,
  floorY: number | null
) {
  if (floorY == null) return;

  const minFromFloor = getMinFromFloorConstraint(snapPoint);
  const maxFromFloor = getMaxFromFloorConstraint(snapPoint);
  if (minFromFloor == null && maxFromFloor == null) return;

  const bbox = new Box3().setFromObject(object);
  if (!Number.isFinite(bbox.min.y) || !Number.isFinite(bbox.max.y)) return;

  const reference = (snapPoint as any)?.verticalConstraint?.reference ?? 'bottom';
  let referenceY = bbox.min.y;
  if (reference === 'center') referenceY = (bbox.min.y + bbox.max.y) / 2;
  if (reference === 'top') referenceY = bbox.max.y;

  let worldDeltaY = 0;
  if (typeof minFromFloor === 'number' && referenceY < floorY + minFromFloor) {
    worldDeltaY = floorY + minFromFloor - referenceY;
  }
  if (typeof maxFromFloor === 'number' && referenceY > floorY + maxFromFloor) {
    worldDeltaY = floorY + maxFromFloor - referenceY;
  }

  if (Math.abs(worldDeltaY) <= EPSILON) return;
  object.position.y += worldDeltaY;
}

export function applySurfaceSnapTransform(
  object: Object3D,
  snapPoint: SnapPoint,
  hit: SurfaceSnapHit,
  floorY: number | null
): void {
  const desiredForward = getDesiredForward(snapPoint, hit.normal);
  const worldQuaternion = getDesiredQuaternion(
    snapPoint,
    desiredForward,
    object.quaternion
  );

  const offsetDistance = getSurfaceSnapOffset(snapPoint);
  const sideDirection = getSurfaceOffsetDirection(snapPoint, hit.normal);
  const anchorPoint = hit.point
    .clone()
    .add(sideDirection.multiplyScalar(offsetDistance));

  const localSnapPosition = getSnapPointLocalPosition(snapPoint);
  const scaledLocalSnap = localSnapPosition.multiply(object.scale);
  const worldSnapOffset = scaledLocalSnap.applyQuaternion(worldQuaternion);
  const worldPosition = anchorPoint.sub(worldSnapOffset);

  const parent = object.parent;
  if (parent) {
    const parentWorldQuat = new Quaternion();
    parent.getWorldQuaternion(parentWorldQuat);
    const parentWorldQuatInv = parentWorldQuat.clone().invert();

    const localPosition = parent.worldToLocal(worldPosition.clone());
    object.position.copy(localPosition);
    object.quaternion.copy(parentWorldQuatInv.multiply(worldQuaternion));
  } else {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
  }

  object.updateMatrixWorld(true);
  clampToVerticalConstraint(object, snapPoint, floorY);
  object.updateMatrixWorld(true);
  object.userData = object.userData || {};
  object.userData.isSurfaceSnapped = true;
}
