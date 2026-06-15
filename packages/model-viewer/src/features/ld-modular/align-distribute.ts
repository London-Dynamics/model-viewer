import {Box3, Object3D, Vector3} from 'three';

import {inferWallNormalWorld} from '../../utilities/surface-snapping.js';

export type AlignAction =
  | 'align-left'
  | 'align-center-h'
  | 'align-right'
  | 'align-top'
  | 'align-center-v'
  | 'align-bottom'
  | 'distribute-h'
  | 'distribute-v'
  | 'distribute-line'
  | 'equal-gap-h'
  | 'equal-gap-v'
  | 'equal-gap-line';

const POSITION_EPS = 1e-4;
const WORLD_UP = new Vector3(0, 1, 0);
const FLOOR_AXIS_H = new Vector3(1, 0, 0);
const FLOOR_AXIS_V = new Vector3(0, 0, 1);

export type FloorLayoutContext = {
  kind: 'floor';
  axisH: Vector3;
  axisV: Vector3;
};

export type WallLayoutContext = {
  kind: 'wall';
  wall: Object3D;
  wallNormal: Vector3;
  axisH: Vector3;
  axisV: Vector3;
};

export type LayoutContext = FloorLayoutContext | WallLayoutContext;

type ObjectLayoutBounds = {
  object: Object3D;
  minH: number;
  maxH: number;
  minV: number;
  maxV: number;
  centerH: number;
  centerV: number;
  widthH: number;
  widthV: number;
};

const DISTRIBUTE_ACTIONS: ReadonlySet<AlignAction> = new Set([
  'distribute-h',
  'distribute-v',
  'distribute-line',
  'equal-gap-h',
  'equal-gap-v',
  'equal-gap-line',
]);

function isWallPlacedObject(object: Object3D): boolean {
  return object.userData?.attachedSurfaceType === 'wall';
}

function getAttachedWallUuid(object: Object3D): string | null {
  const uuid = object.userData?.attachedWallUuid;
  return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
}

function buildWallAxisH(wallNormal: Vector3, out: Vector3): Vector3 {
  out.crossVectors(WORLD_UP, wallNormal);
  if (out.lengthSq() < 1e-8) {
    out.set(1, 0, 0).cross(wallNormal);
  }
  return out.normalize();
}

function withRotationIgnored<T>(
  object: Object3D,
  fn: () => T
): T {
  const savedRotation = object.rotation.clone();
  const savedQuaternion = object.quaternion.clone();
  const savedLogical = object.userData?.ldLogicalRotationDeg;

  object.rotation.set(0, 0, 0);
  object.quaternion.set(0, 0, 0, 1);
  if (object.userData?.ldLogicalRotationDeg) {
    delete object.userData.ldLogicalRotationDeg;
  }
  object.updateMatrixWorld(true);

  try {
    return fn();
  } finally {
    object.rotation.copy(savedRotation);
    object.quaternion.copy(savedQuaternion);
    object.userData = object.userData || {};
    if (savedLogical) {
      object.userData.ldLogicalRotationDeg = savedLogical;
    } else {
      delete object.userData.ldLogicalRotationDeg;
    }
    object.updateMatrixWorld(true);
  }
}

function projectWorldToHV(
  world: Vector3,
  context: LayoutContext,
  out: {h: number; v: number}
): {h: number; v: number} {
  if (context.kind === 'floor') {
    out.h = world.x;
    out.v = world.z;
    return out;
  }
  out.h = world.dot(context.axisH);
  out.v = world.y;
  return out;
}

function computeObjectLayoutBounds(
  object: Object3D,
  context: LayoutContext
): ObjectLayoutBounds | null {
  const box = new Box3();
  const corner = new Vector3();
  let minH = Infinity;
  let maxH = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  const hasCorners = withRotationIgnored(object, () => {
    box.setFromObject(object);
    return (
      Number.isFinite(box.min.x) &&
      Number.isFinite(box.max.x) &&
      !box.isEmpty()
    );
  });

  if (!hasCorners) {
    return null;
  }

  const corners = [
    [box.min.x, box.min.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.max.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.min.z],
    [box.max.x, box.max.y, box.max.z],
  ] as const;

  const hv = {h: 0, v: 0};
  for (const [x, y, z] of corners) {
    corner.set(x, y, z);
    projectWorldToHV(corner, context, hv);
    minH = Math.min(minH, hv.h);
    maxH = Math.max(maxH, hv.h);
    minV = Math.min(minV, hv.v);
    maxV = Math.max(maxV, hv.v);
  }

  if (
    !Number.isFinite(minH) ||
    !Number.isFinite(maxH) ||
    !Number.isFinite(minV) ||
    !Number.isFinite(maxV)
  ) {
    return null;
  }

  return {
    object,
    minH,
    maxH,
    minV,
    maxV,
    centerH: (minH + maxH) / 2,
    centerV: (minV + maxV) / 2,
    widthH: maxH - minH,
    widthV: maxV - minV,
  };
}

function deltaWorldFromHV(
  deltaH: number,
  deltaV: number,
  context: LayoutContext,
  out: Vector3
): Vector3 {
  out.set(0, 0, 0);
  if (Math.abs(deltaH) > POSITION_EPS) {
    out.addScaledVector(context.axisH, deltaH);
  }
  if (Math.abs(deltaV) > POSITION_EPS) {
    out.addScaledVector(context.axisV, deltaV);
  }
  return out;
}

function unionBounds(items: ObjectLayoutBounds[]) {
  let minH = Infinity;
  let maxH = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const item of items) {
    minH = Math.min(minH, item.minH);
    maxH = Math.max(maxH, item.maxH);
    minV = Math.min(minV, item.minV);
    maxV = Math.max(maxV, item.maxV);
  }
  return {
    minH,
    maxH,
    minV,
    maxV,
    centerH: (minH + maxH) / 2,
    centerV: (minV + maxV) / 2,
  };
}

function setDelta(
  deltas: Map<string, Vector3>,
  object: Object3D,
  deltaH: number,
  deltaV: number,
  context: LayoutContext,
  scratch: Vector3
) {
  deltaWorldFromHV(deltaH, deltaV, context, scratch);
  if (scratch.lengthSq() <= POSITION_EPS * POSITION_EPS) {
    return;
  }
  const existing = deltas.get(object.uuid);
  if (existing) {
    existing.add(scratch);
  } else {
    deltas.set(object.uuid, scratch.clone());
  }
}

export function resolveLayoutContext(
  targets: Object3D[],
  getObjectByUuid: (uuid: string) => Object3D | null
): LayoutContext | null {
  if (targets.length < 2) {
    return null;
  }

  const wallFlags = targets.map(isWallPlacedObject);
  const anyWall = wallFlags.some(Boolean);
  const allWall = wallFlags.every(Boolean);

  if (anyWall && !allWall) {
    return null;
  }

  if (allWall) {
    const wallUuid = getAttachedWallUuid(targets[0]);
    if (!wallUuid) {
      return null;
    }
    for (const target of targets) {
      if (getAttachedWallUuid(target) !== wallUuid) {
        return null;
      }
    }
    const wall = getObjectByUuid(wallUuid);
    if (!wall) {
      return null;
    }

    const wallNormal = inferWallNormalWorld(wall);
    const axisH = buildWallAxisH(wallNormal, new Vector3());
    return {
      kind: 'wall',
      wall,
      wallNormal,
      axisH,
      axisV: WORLD_UP.clone(),
    };
  }

  return {
    kind: 'floor',
    axisH: FLOOR_AXIS_H.clone(),
    axisV: FLOOR_AXIS_V.clone(),
  };
}

export function getAlignActionLabel(action: AlignAction, count: number): string {
  const labels: Record<AlignAction, string> = {
    'align-left': 'Align left',
    'align-center-h': 'Align center horizontally',
    'align-right': 'Align right',
    'align-top': 'Align top',
    'align-center-v': 'Align center vertically',
    'align-bottom': 'Align bottom',
    'distribute-h': 'Distribute horizontally',
    'distribute-v': 'Distribute vertically',
    'distribute-line': 'Distribute along line',
    'equal-gap-h': 'Equal horizontal gap',
    'equal-gap-v': 'Equal vertical gap',
    'equal-gap-line': 'Equal gap along line',
  };
  const verb = labels[action] ?? 'Align';
  return count === 1 ? verb : `${verb} (${count} objects)`;
}

export function applyWorldPositionDelta(
  object: Object3D,
  deltaWorld: Vector3
): void {
  const worldPos = new Vector3();
  object.updateMatrixWorld(true);
  object.getWorldPosition(worldPos);
  worldPos.add(deltaWorld);
  if (object.parent) {
    object.parent.worldToLocal(worldPos);
    object.position.copy(worldPos);
  } else {
    object.position.copy(worldPos);
  }
  object.updateMatrixWorld(true);
}

export function computeAlignDistributeDeltas(
  action: AlignAction,
  targets: Object3D[],
  context: LayoutContext
): Map<string, Vector3> {
  const deltas = new Map<string, Vector3>();
  if (targets.length < 2) {
    return deltas;
  }
  if (DISTRIBUTE_ACTIONS.has(action) && targets.length < 3) {
    return deltas;
  }

  const bounds = targets
    .map((object) => computeObjectLayoutBounds(object, context))
    .filter((item): item is ObjectLayoutBounds => item != null);
  if (bounds.length < targets.length || bounds.length < 2) {
    return deltas;
  }

  const scratch = new Vector3();
  const selection = unionBounds(bounds);

  switch (action) {
    case 'align-left':
      for (const item of bounds) {
        setDelta(deltas, item.object, selection.minH - item.minH, 0, context, scratch);
      }
      break;
    case 'align-center-h':
      for (const item of bounds) {
        setDelta(
          deltas,
          item.object,
          selection.centerH - item.centerH,
          0,
          context,
          scratch
        );
      }
      break;
    case 'align-right':
      for (const item of bounds) {
        setDelta(deltas, item.object, selection.maxH - item.maxH, 0, context, scratch);
      }
      break;
    case 'align-top':
      for (const item of bounds) {
        setDelta(deltas, item.object, 0, selection.minV - item.minV, context, scratch);
      }
      break;
    case 'align-center-v':
      for (const item of bounds) {
        setDelta(
          deltas,
          item.object,
          0,
          selection.centerV - item.centerV,
          context,
          scratch
        );
      }
      break;
    case 'align-bottom':
      for (const item of bounds) {
        setDelta(deltas, item.object, 0, selection.maxV - item.maxV, context, scratch);
      }
      break;
    case 'distribute-h': {
      const sorted = [...bounds].sort((a, b) => a.centerH - b.centerH);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.centerH - first.centerH;
      for (let i = 1; i < sorted.length - 1; i++) {
        const targetCenter = first.centerH + (span * i) / (sorted.length - 1);
        setDelta(
          deltas,
          sorted[i].object,
          targetCenter - sorted[i].centerH,
          0,
          context,
          scratch
        );
      }
      break;
    }
    case 'distribute-v': {
      const sorted = [...bounds].sort((a, b) => a.centerV - b.centerV);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.centerV - first.centerV;
      for (let i = 1; i < sorted.length - 1; i++) {
        const targetCenter = first.centerV + (span * i) / (sorted.length - 1);
        setDelta(
          deltas,
          sorted[i].object,
          0,
          targetCenter - sorted[i].centerV,
          context,
          scratch
        );
      }
      break;
    }
    case 'distribute-line': {
      const sortedByH = [...bounds].sort((a, b) => a.centerH - b.centerH);
      const anchorFirst = sortedByH[0];
      const anchorLast = sortedByH[sortedByH.length - 1];
      const dirH = anchorLast.centerH - anchorFirst.centerH;
      const dirV = anchorLast.centerV - anchorFirst.centerV;
      const lenSq = dirH * dirH + dirV * dirV;
      const withProjection = bounds
        .map((item) => ({
          item,
          t:
            lenSq > POSITION_EPS
              ? ((item.centerH - anchorFirst.centerH) * dirH +
                  (item.centerV - anchorFirst.centerV) * dirV) /
                lenSq
              : 0,
        }))
        .sort((a, b) => a.t - b.t);
      const first = withProjection[0].item;
      const last = withProjection[withProjection.length - 1].item;
      for (let i = 1; i < withProjection.length - 1; i++) {
        const t = i / (withProjection.length - 1);
        const targetH = first.centerH + (last.centerH - first.centerH) * t;
        const targetV = first.centerV + (last.centerV - first.centerV) * t;
        const entry = withProjection[i].item;
        setDelta(
          deltas,
          entry.object,
          targetH - entry.centerH,
          targetV - entry.centerV,
          context,
          scratch
        );
      }
      break;
    }
    case 'equal-gap-h': {
      const sorted = [...bounds].sort((a, b) => a.minH - b.minH);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.maxH - first.minH;
      const sumWidths = sorted.reduce((sum, item) => sum + item.widthH, 0);
      const gap = (totalSpan - sumWidths) / (sorted.length - 1);
      let cursor = first.maxH;
      for (let i = 1; i < sorted.length - 1; i++) {
        const item = sorted[i];
        const targetMinH = cursor + gap;
        setDelta(deltas, item.object, targetMinH - item.minH, 0, context, scratch);
        cursor = targetMinH + item.widthH;
      }
      break;
    }
    case 'equal-gap-v': {
      const sorted = [...bounds].sort((a, b) => a.minV - b.minV);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.maxV - first.minV;
      const sumHeights = sorted.reduce((sum, item) => sum + item.widthV, 0);
      const gap = (totalSpan - sumHeights) / (sorted.length - 1);
      let cursor = first.maxV;
      for (let i = 1; i < sorted.length - 1; i++) {
        const item = sorted[i];
        const targetMinV = cursor + gap;
        setDelta(deltas, item.object, 0, targetMinV - item.minV, context, scratch);
        cursor = targetMinV + item.widthV;
      }
      break;
    }
    case 'equal-gap-line': {
      const sortedByH = [...bounds].sort((a, b) => a.centerH - b.centerH);
      const anchorFirst = sortedByH[0];
      const anchorLast = sortedByH[sortedByH.length - 1];
      const dirH = anchorLast.centerH - anchorFirst.centerH;
      const dirV = anchorLast.centerV - anchorFirst.centerV;
      const dirLen = Math.hypot(dirH, dirV);
      if (dirLen <= POSITION_EPS) {
        break;
      }
      const ux = dirH / dirLen;
      const uv = dirV / dirLen;

      const projections = bounds
        .map((item) => {
          const relH = item.minH - anchorFirst.minH;
          const relV = item.minV - anchorFirst.minV;
          const start = relH * ux + relV * uv;
          const relH2 = item.maxH - anchorFirst.minH;
          const relV2 = item.maxV - anchorFirst.minV;
          const end = relH2 * ux + relV2 * uv;
          return {item, start: Math.min(start, end), end: Math.max(start, end)};
        })
        .sort((a, b) => a.start - b.start);

      const gapAnchorFirst = projections[0];
      const gapAnchorLast = projections[projections.length - 1];
      const totalSpan = gapAnchorLast.end - gapAnchorFirst.start;
      const sumSpans = projections.reduce(
        (sum, entry) => sum + (entry.end - entry.start),
        0
      );
      const gap = (totalSpan - sumSpans) / (projections.length - 1);
      let cursor = gapAnchorFirst.end;
      for (let i = 1; i < projections.length - 1; i++) {
        const entry = projections[i];
        const targetStart = cursor + gap;
        const deltaAlong = targetStart - entry.start;
        setDelta(
          deltas,
          entry.item.object,
          deltaAlong * ux,
          deltaAlong * uv,
          context,
          scratch
        );
        cursor = targetStart + (entry.end - entry.start);
      }
      break;
    }
    default:
      break;
  }

  return deltas;
}
