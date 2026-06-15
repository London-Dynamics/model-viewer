export type TransformComponent = 'position' | 'rotation' | 'scale';
export type TransformAxis = 'x' | 'y' | 'z';
export type TransformSource =
  | 'pointer-drag'
  | 'rotation-disc-y'
  | 'api'
  | 'animation'
  | 'align-distribute';

export type TransformValues = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

/** Human-readable label; falls back to `Object3D.name` when unset. */
export type TransformTarget = {uuid: string; name: string};

export function getObjectDisplayName(object: {
  name: string;
  userData?: {name?: string; part?: {name?: string}};
}): string {
  return (
    object.userData?.name ?? object.userData?.part?.name ?? object.name
  );
}

export type ActiveTransform = {
  source: TransformSource;
  components: TransformComponent[];
  axes: Partial<Record<TransformComponent, TransformAxis[]>>;
  /** Change since the gesture began (not normalized absolute transform values). */
  delta: TransformValues;
};

/** Wrap a single angle delta to [-180, 180) degrees. */
export function normalizeAngleDeltaDeg(deg: number): number {
  if (!Number.isFinite(deg)) {
    return 0;
  }
  const normalized = ((deg % 360) + 360) % 360;
  return normalized >= 180 ? normalized - 360 : normalized;
}

/** Shortest signed delta in degrees on [-180, 180). */
export function shortestAngleDeltaDeg(
  currentDeg: number,
  startDeg: number
): number {
  return normalizeAngleDeltaDeg(currentDeg - startDeg);
}

/**
 * Build gesture deltas from start vs current snapshots.
 * When `rotationYDelta` is set (rotation disc), Y uses accumulated applied
 * degrees (then normalized). All rotation deltas are in [-180, 180).
 */
export function computeTransformDelta(
  current: TransformValues,
  start: TransformValues,
  options?: {rotationYDelta?: number}
): TransformValues {
  const rotationY = normalizeAngleDeltaDeg(
    options?.rotationYDelta ??
      shortestAngleDeltaDeg(current.rotation[1], start.rotation[1])
  );
  return {
    position: [
      current.position[0] - start.position[0],
      current.position[1] - start.position[1],
      current.position[2] - start.position[2],
    ],
    rotation: [
      shortestAngleDeltaDeg(current.rotation[0], start.rotation[0]),
      rotationY,
      shortestAngleDeltaDeg(current.rotation[2], start.rotation[2]),
    ],
    scale: [
      current.scale[0] - start.scale[0],
      current.scale[1] - start.scale[1],
      current.scale[2] - start.scale[2],
    ],
  };
}

export type TransformEventDetail = {
  target: TransformTarget;
  /** Present when a gesture affects two or more roots (multi-select). */
  targets?: TransformTarget[];
  transform: TransformValues;
  active: ActiveTransform | null;
};

/** Stable pivot proxy id for multi-select transform sessions. */
export const SELECTION_TRANSFORM_PIVOT_UUID = 'ld-selection-pivot';
export const SELECTION_TRANSFORM_PIVOT_NAME = 'selection';

export type BeginTransformSessionOptions = {
  source: TransformSource;
  components: TransformComponent[];
  axes?: Partial<Record<TransformComponent, TransformAxis[]>>;
  historyLabel?: string;
};

export type ParsedRotationAxisInput = {
  isRelative: boolean;
  delta?: number;
  absolute?: number;
};

/** Which Euler axes are affected by a rotation API call. */
export function inferRotationAxesFromParsed(
  parsed: ParsedRotationAxisInput[],
  current: [number, number, number]
): TransformAxis[] {
  const axes: TransformAxis[] = [];
  const labels: TransformAxis[] = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    if (parsed[i].isRelative) {
      axes.push(labels[i]);
    } else if (Math.abs((parsed[i].absolute ?? 0) - current[i]) >= 1e-6) {
      axes.push(labels[i]);
    }
  }
  return axes.length > 0 ? axes : ['x', 'y', 'z'];
}
