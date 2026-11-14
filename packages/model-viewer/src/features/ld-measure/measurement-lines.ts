import {
  Box3,
  BufferGeometry,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import {
  SELECTION_TRANSFORM_PIVOT_UUID,
  type TransformEventDetail,
  type TransformValues,
} from '../ld-modular/transform-events.js';
import {
  AZIMUTHAL_OCTANT_LABELS,
  HALF_PI,
  QUARTER_PI,
  TAU,
} from '../../utilities/ld-utils.js';

export const MEASUREMENT_FRAME_NAME = 'ld-measurement-frame';
export const HETEROGENEOUS_ROTATION_THRESHOLD_DEG = 45;

/** Screen-space stroke behind the coloured core, in CSS pixels. */
export const MEASUREMENT_LINE_HALO_COLOR = 0xf5f4f2;
export const MEASUREMENT_LINE_HALO_WIDTH = 3;
export const MEASUREMENT_LINE_HALO_RENDER_ORDER = 9998;

/** Screen-space stroke drawn over the halo, in CSS pixels. */
export const MEASUREMENT_LINE_CORE_COLOR = 0x2f6bff;
export const MEASUREMENT_LINE_CORE_WIDTH = 1;
export const MEASUREMENT_LINE_CORE_RENDER_ORDER = 9999;

type MeasurementViewSize = {
  width: number;
  height: number;
};

export type MeasurementLineMaterials = {
  halo: LineMaterial;
  core: LineMaterial;
};

function createMeasurementLineMaterial(
  color: number,
  linewidth: number
): LineMaterial {
  return new LineMaterial({
    color,
    linewidth,
    worldUnits: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 1,
    toneMapped: false,
  });
}

export function createMeasurementLineMaterials(): MeasurementLineMaterials {
  return {
    halo: createMeasurementLineMaterial(
      MEASUREMENT_LINE_HALO_COLOR,
      MEASUREMENT_LINE_HALO_WIDTH
    ),
    core: createMeasurementLineMaterial(
      MEASUREMENT_LINE_CORE_COLOR,
      MEASUREMENT_LINE_CORE_WIDTH
    ),
  };
}

function syncMeasurementLineResolution(
  materials: LineMaterial[],
  view: MeasurementViewSize
): void {
  const { width, height } = view;
  if (!(width > 0) || !(height > 0)) {
    return;
  }
  for (const material of materials) {
    if (material.resolution.x !== width || material.resolution.y !== height) {
      material.resolution.set(width, height);
    }
  }
}

function bindMeasurementLine(
  line: Line2,
  materials: LineMaterial[],
  view: MeasurementViewSize,
  renderOrder: number
): void {
  line.userData.noHit = true;
  line.userData.skipShadow = true;
  line.castShadow = false;
  line.renderOrder = renderOrder;
  line.visible = false;
  line.frustumCulled = false;
  // Line2's own callback copies the GL viewport, which is device pixels here.
  // CSS size keeps linewidth constant on screen across DPR and GPU scale.
  line.onBeforeRender = () => {
    syncMeasurementLineResolution(materials, view);
  };
}

/** Halo then core, sharing one geometry. Halo is first so label anchors stay on the segment. */
export function createMeasurementLinePair(
  points: Vector3[],
  materials: MeasurementLineMaterials,
  view: MeasurementViewSize
): [Line2, Line2] {
  const geometry = new LineGeometry();
  const positions: number[] = [];
  for (const point of points) {
    positions.push(point.x, point.y, point.z);
  }
  geometry.setPositions(positions);

  const materialList = [materials.halo, materials.core];
  const halo = new Line2(geometry, materials.halo);
  const core = new Line2(geometry, materials.core);
  bindMeasurementLine(
    halo,
    materialList,
    view,
    MEASUREMENT_LINE_HALO_RENDER_ORDER
  );
  bindMeasurementLine(
    core,
    materialList,
    view,
    MEASUREMENT_LINE_CORE_RENDER_ORDER
  );
  syncMeasurementLineResolution(materialList, view);
  return [halo, core];
}

function disposeMeasurementObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) {
      if (material) {
        materials.add(material);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

type MeasurementDeps = {
  sceneSymbol: symbol;
};

const tmpBox = new Box3();
const tmpMatrix = new Matrix4();
const tmpViewLocal = new Vector3();
const cornerScratch = Array.from({ length: 8 }, () => new Vector3());

function boxCorners(min: Vector3, max: Vector3, target: Vector3[]): void {
  target[0].set(min.x, min.y, min.z);
  target[1].set(max.x, min.y, min.z);
  target[2].set(max.x, max.y, min.z);
  target[3].set(min.x, max.y, min.z);
  target[4].set(min.x, min.y, max.z);
  target[5].set(max.x, min.y, max.z);
  target[6].set(max.x, max.y, max.z);
  target[7].set(min.x, max.y, max.z);
}

function expandBoxByTransformedCorners(
  target: Box3,
  min: Vector3,
  max: Vector3,
  matrix: Matrix4
): void {
  boxCorners(min, max, cornerScratch);
  for (const corner of cornerScratch) {
    corner.applyMatrix4(matrix);
    target.expandByPoint(corner);
  }
}

/** Union mesh geometry bounds in root local space (true OBB axes). */
export function computeLocalBoundingBox(root: Object3D): Box3 {
  const box = new Box3();
  box.makeEmpty();
  const relativeMatrix = new Matrix4();
  const rootInverse = new Matrix4();

  root.updateWorldMatrix(true, true);
  rootInverse.copy(root.matrixWorld).invert();

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    if (!mesh.geometry.boundingBox) {
      return;
    }
    relativeMatrix.multiplyMatrices(rootInverse, mesh.matrixWorld);
    expandBoxByTransformedCorners(
      box,
      mesh.geometry.boundingBox.min,
      mesh.geometry.boundingBox.max,
      relativeMatrix
    );
  });

  if (box.isEmpty()) {
    tmpBox.setFromObject(root);
    expandBoxByTransformedCorners(box, tmpBox.min, tmpBox.max, rootInverse);
  }

  return box;
}

export function rotationYSpreadDeg(roots: Object3D[]): number {
  if (roots.length < 2) {
    return 0;
  }
  const first = roots[0].rotation.y;
  let maxSpreadRad = 0;
  for (let i = 1; i < roots.length; i++) {
    let delta = Math.abs(roots[i].rotation.y - first);
    delta = Math.min(delta, Math.abs(2 * Math.PI - delta));
    maxSpreadRad = Math.max(maxSpreadRad, delta);
  }
  return (maxSpreadRad * 180) / Math.PI;
}

function unionBoxCornersInto(
  union: Box3,
  min: Vector3,
  max: Vector3,
  matrix: Matrix4
): void {
  expandBoxByTransformedCorners(union, min, max, matrix);
}

/** Union root bounds expressed in frame local space. */
export function computeUnionBoundingBoxInFrame(
  roots: Object3D[],
  frame: Object3D,
  useWorldAabbFallback: boolean
): Box3 {
  const union = new Box3();
  union.makeEmpty();

  frame.updateMatrixWorld(true);
  const frameInv = new Matrix4().copy(frame.matrixWorld).invert();
  const toFrame = new Matrix4();

  for (const root of roots) {
    root.updateMatrixWorld(true);
    if (useWorldAabbFallback) {
      tmpBox.setFromObject(root);
      unionBoxCornersInto(union, tmpBox.min, tmpBox.max, frameInv);
    } else {
      const localBox = computeLocalBoundingBox(root);
      toFrame.multiplyMatrices(frameInv, root.matrixWorld);
      unionBoxCornersInto(union, localBox.min, localBox.max, toFrame);
    }
  }

  return union;
}

export function computePivotOnFloor(
  roots: Object3D[],
  floorY: number
): Vector3 {
  const worldBox = new Box3();
  worldBox.makeEmpty();
  for (const root of roots) {
    worldBox.expandByObject(root);
  }
  const pivot = new Vector3();
  worldBox.getCenter(pivot);
  pivot.y = floorY;
  return pivot;
}

export function setupMeasurementFrame(
  frame: Object3D,
  roots: Object3D[],
  sceneTarget: Object3D,
  floorY: number
): { useWorldAabbFallback: boolean } {
  const spreadDeg = rotationYSpreadDeg(roots);
  const useWorldAabbFallback = spreadDeg > HETEROGENEOUS_ROTATION_THRESHOLD_DEG;
  const pivot = computePivotOnFloor(roots, floorY);

  frame.position.copy(pivot);
  frame.rotation.set(0, useWorldAabbFallback ? 0 : roots[0].rotation.y, 0);
  frame.scale.set(1, 1, 1);

  if (!frame.parent) {
    sceneTarget.add(frame);
  }
  frame.updateMatrixWorld(true);

  return { useWorldAabbFallback };
}

export function syncMeasurementFrameFromRoots(
  frame: Object3D,
  roots: Object3D[],
  floorY: number,
  useWorldAabbFallback: boolean
): void {
  if (roots.length === 0) {
    return;
  }
  const pivot = computePivotOnFloor(roots, floorY);
  frame.position.copy(pivot);
  if (!useWorldAabbFallback) {
    frame.rotation.y = roots[0].rotation.y;
  }
  frame.updateMatrixWorld(true);
}

/** Sync frame from multi-select pivot transform (fixed pivot during rotation). */
export function syncMeasurementFrameFromPivotTransform(
  frame: Object3D,
  transform: TransformValues,
  baseRotationYRad: number,
  useWorldAabbFallback: boolean
): void {
  frame.position.set(
    transform.position[0],
    transform.position[1],
    transform.position[2]
  );
  if (!useWorldAabbFallback) {
    frame.rotation.y =
      baseRotationYRad + (transform.rotation[1] * Math.PI) / 180;
  }
  frame.updateMatrixWorld(true);
}

export function getViewOctantLabelInSpace(
  measurementSpace: Object3D,
  cameraWorldPosition: Vector3
): string {
  measurementSpace.updateMatrixWorld(true);
  tmpMatrix.copy(measurementSpace.matrixWorld).invert();
  tmpViewLocal.copy(cameraWorldPosition).applyMatrix4(tmpMatrix);

  const theta = Math.atan2(tmpViewLocal.x, tmpViewLocal.z);
  const azimuthalOctant =
    (8 + Math.floor(((theta % TAU) + QUARTER_PI / 2) / (HALF_PI / 2))) % 8;

  return AZIMUTHAL_OCTANT_LABELS[azimuthalOctant];
}

export type MeasurementLineAnchors = {
  width: number;
  height: number;
  depth: number;
};

const NORTH = 0;
const EAST = 1;
const SOUTH = 2;
const WEST = 3;
const NORTH_A = 4;
const NORTH_B = 5;
const EAST_A = 6;
const EAST_B = 7;
const SOUTH_A = 8;
const SOUTH_B = 9;
const WEST_A = 10;
const WEST_B = 11;

/**
 * Floor width, vertical height, and floor depth line-group indices.
 * Height is the far vertical edge of the side already chosen for this octant.
 */
export function measurementLineAnchors(
  octant: string
): MeasurementLineAnchors | null {
  switch (octant) {
    case 'front':
      return { width: SOUTH, height: WEST_B, depth: EAST };
    case 'front-right':
      return { width: SOUTH, height: NORTH_A, depth: EAST };
    case 'right':
      return { width: NORTH, height: SOUTH_B, depth: EAST };
    case 'back-right':
      return { width: NORTH, height: WEST_A, depth: EAST };
    case 'back':
      return { width: NORTH, height: EAST_B, depth: WEST };
    case 'back-left':
      return { width: NORTH, height: SOUTH_A, depth: WEST };
    case 'left':
      return { width: SOUTH, height: NORTH_B, depth: WEST };
    case 'front-left':
      return { width: SOUTH, height: EAST_A, depth: WEST };
    default:
      return null;
  }
}

function findSceneTarget(scene: Object3D): Object3D | null {
  let target: Object3D | null = null;
  scene.traverse((child) => {
    if (child.name === 'Target') {
      target = child;
    }
  });
  return target;
}

export function disposeMeasurementFrame(host: {
  _measurementFrame?: Object3D | null;
  _measurementSpace?: Object3D | null;
}): void {
  if (host._measurementFrame?.parent) {
    host._measurementFrame.parent.remove(host._measurementFrame);
  }
  host._measurementFrame = null;
  host._measurementSpace = null;
}

export function clearMeasurements(
  host: any,
  deps: MeasurementDeps,
  resetEverything = false
) {
  if (resetEverything) {
    host._measuredObjects = [];
    host._measuredSelectionKey = '';
    host._measurementUsesWorldAabbFallback = false;
    host._measurementFrameBaseRotationY = 0;
    disposeMeasurementFrame(host);
  }

  const scene = host[deps.sceneSymbol];
  try {
    scene.traverse((child: Object3D) => {
      if (child.name === 'ld-measurements') {
        disposeMeasurementObject(child);
        child.parent?.remove(child);
        throw new Error('Line parent found and removed');
      }
    });
  } catch (e) {
    if ((e as Error).message !== 'Line parent found and removed') {
      throw e;
    }
  }

  host._lineGroups = [];
  if (host._measureWidthElement)
    host._measureWidthElement.style.display = 'none';
  if (host._measureHeightElement)
    host._measureHeightElement.style.display = 'none';
  if (host._measureDepthElement)
    host._measureDepthElement.style.display = 'none';
  host.requestUpdate?.();
}

export function getEdgeGroups(
  _corners: Vector3[],
  length: number,
  margin: number
) {
  const corners = _corners.map((corner) => corner.clone());
  const gap = margin * 0.25;
  const overshoot = margin * 0;

  return [
    [
      [
        new Vector3(corners[0].x, corners[0].y, corners[0].z - length - margin),
        new Vector3(corners[1].x, corners[1].y, corners[1].z - length - margin),
      ],
      [
        new Vector3(corners[0].x, corners[0].y, corners[0].z - gap),
        new Vector3(
          corners[0].x,
          corners[0].y,
          corners[0].z - length - margin - overshoot
        ),
      ],
      [
        new Vector3(corners[1].x, corners[1].y, corners[1].z - gap),
        new Vector3(
          corners[1].x,
          corners[1].y,
          corners[1].z - length - margin - overshoot
        ),
      ],
    ],
    [
      [
        new Vector3(corners[1].x + length + margin, corners[1].y, corners[1].z),
        new Vector3(corners[5].x + length + margin, corners[5].y, corners[5].z),
      ],
      [
        new Vector3(corners[1].x + gap, corners[1].y, corners[1].z),
        new Vector3(
          corners[1].x + length + margin + overshoot,
          corners[1].y,
          corners[1].z
        ),
      ],
      [
        new Vector3(corners[5].x + gap, corners[5].y, corners[5].z),
        new Vector3(
          corners[5].x + length + margin + overshoot,
          corners[5].y,
          corners[5].z
        ),
      ],
    ],
  ];
}

function buildMeasurementLines(
  host: any,
  boundingBox: Box3,
  linesParentObject: Object3D | null,
  needsCoordinateTransform: boolean,
  edgeGroupObject: Object3D,
  view: MeasurementViewSize
) {
  if (
    boundingBox.min.equals(new Vector3(Infinity, Infinity, Infinity)) ||
    boundingBox.max.equals(new Vector3(-Infinity, -Infinity, -Infinity))
  ) {
    console.warn('Bounding box is empty.');
    return;
  }

  const min = boundingBox.min.clone();
  const max = boundingBox.max.clone();
  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ];

  const lineMaterials = createMeasurementLineMaterials();

  const objectSize = boundingBox.getSize(new Vector3());
  const minDimension = Math.min(objectSize.x, objectSize.y, objectSize.z);
  const length =
    minDimension > 0 ? minDimension / 10 : host._extensionLineLength;
  const margin = length / 2;
  const edgeGroups = host._getEdgeGroups(
    corners,
    length,
    margin,
    edgeGroupObject
  );
  const lineParent = new Object3D();
  lineParent.name = 'ld-measurements';

  const inverseMatrix = new Matrix4();

  if (linesParentObject) {
    if (needsCoordinateTransform) {
      linesParentObject.updateWorldMatrix(true, false);
      inverseMatrix.copy(linesParentObject.matrixWorld).invert();
    }
    linesParentObject.add(lineParent);
  }

  const toLocalSpace = (point: Vector3): Vector3 =>
    needsCoordinateTransform
      ? point.clone().applyMatrix4(inverseMatrix)
      : point.clone();

  edgeGroups.forEach((group: Array<Array<Vector3>>) => {
    const lines: Line2[] = [];
    group.forEach((edge) => {
      const localEdge = edge.map((point) => toLocalSpace(point));
      const pair = createMeasurementLinePair(localEdge, lineMaterials, view);
      for (const line of pair) {
        lineParent.add(line);
        lines.push(line);
      }
    });
    host._lineGroups.push({ lines });
  });

  host._refreshMeasurementVisibility();
  host._updateMarkerText(boundingBox, edgeGroupObject);
}

export function measureObject(
  host: any,
  deps: MeasurementDeps,
  object: Object3D,
  skipLastClickCheck?: boolean
) {
  measureObjects(host, deps, [object], skipLastClickCheck);
}

export function measureObjects(
  host: any,
  deps: MeasurementDeps,
  objects: Object3D[],
  skipLastClickCheck?: boolean
) {
  const scene = host[deps.sceneSymbol];
  const roots = objects.filter(Boolean);
  if (roots.length === 0) return;

  const selectionKey = roots.map((o) => o.uuid).join(',');
  if (!skipLastClickCheck && selectionKey === host._measuredSelectionKey) {
    return;
  }

  host._measuredSelectionKey = selectionKey;
  host._measuredObjects = [...roots];
  host._clearMeasurements();

  let boundingBox: Box3;
  let linesParentObject: Object3D | null = null;
  let needsCoordinateTransform = false;
  let edgeGroupObject: Object3D;

  if (roots.length === 1 && roots[0] === scene) {
    boundingBox = host._getBoundingBox(scene, roots[0]);
    linesParentObject = findSceneTarget(scene);
    edgeGroupObject = scene;
    host._measurementSpace = null;
  } else if (roots.length === 1) {
    boundingBox = computeLocalBoundingBox(roots[0]);
    linesParentObject = roots[0];
    needsCoordinateTransform = false;
    edgeGroupObject = roots[0];
    host._measurementSpace = roots[0];
    host._measurementUsesWorldAabbFallback = false;
  } else {
    const sceneTarget = findSceneTarget(scene);
    if (!sceneTarget) {
      return;
    }
    if (!host._measurementFrame) {
      host._measurementFrame = new Object3D();
      host._measurementFrame.name = MEASUREMENT_FRAME_NAME;
    }
    const floorY = host._getMeasureFloorY(roots[0]);
    const { useWorldAabbFallback } = setupMeasurementFrame(
      host._measurementFrame,
      roots,
      sceneTarget,
      floorY
    );
    host._measurementUsesWorldAabbFallback = useWorldAabbFallback;
    host._measurementFrameBaseRotationY = roots[0].rotation.y;
    boundingBox = computeUnionBoundingBoxInFrame(
      roots,
      host._measurementFrame,
      useWorldAabbFallback
    );
    linesParentObject = host._measurementFrame;
    needsCoordinateTransform = false;
    edgeGroupObject = host._measurementFrame;
    host._measurementSpace = host._measurementFrame;
  }

  buildMeasurementLines(
    host,
    boundingBox,
    linesParentObject,
    needsCoordinateTransform,
    edgeGroupObject,
    scene
  );
}

export function syncMeasurementTransform(
  host: any,
  roots: Object3D[],
  transformDetail?: TransformEventDetail | null
): void {
  if (!host.measure || roots.length === 0) {
    return;
  }

  if (roots.length === 1 && host._measurementSpace === roots[0]) {
    host._refreshMeasurementVisibility();
    return;
  }

  if (host._measurementFrame && roots.length > 1) {
    if (transformDetail?.target.uuid === SELECTION_TRANSFORM_PIVOT_UUID) {
      syncMeasurementFrameFromPivotTransform(
        host._measurementFrame,
        transformDetail.transform,
        host._measurementFrameBaseRotationY ?? roots[0].rotation.y,
        host._measurementUsesWorldAabbFallback
      );
    } else {
      const floorY = host._getMeasureFloorY(roots[0]);
      syncMeasurementFrameFromRoots(
        host._measurementFrame,
        roots,
        floorY,
        host._measurementUsesWorldAabbFallback
      );
    }
    host._refreshMeasurementVisibility();
  }
}
