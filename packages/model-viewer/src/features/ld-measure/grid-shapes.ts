import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector2,
} from 'three';

type GridShapeDeps = {
  sceneSymbol: symbol;
  gridContainerSymbol: symbol;
  needsRenderSymbol: symbol;
  createGrid: () => void;
  getGridTargetObject: () => Object3D | null;
};

const GRID_SHAPES_CONTAINER_NAME = 'ld-grid-shapes';
const DEFAULT_GRID_SHAPE_THICKNESS = 0.025;

/**
 * One floor-grid stroke. Plan [x, y] is world [x, z].
 * Matches `@london-dynamics/types` `GridShapeLine` without importing that package.
 */
export type GridShapeLine = {
  points: Array<[number, number]>;
  /** Width in meters. Omitted strokes use the call's thickness. */
  thickness?: number;
  /**
   * Join the last point to the first.
   * Omitted keeps the legacy rule: close when there are more than two points.
   */
  closed?: boolean;
};

export type GridShapePaths =
  | GridShapeLine[]
  | Array<Array<[number, number]>>
  | Array<[number, number]>;

export type ResolvedGridShapeStroke = {
  points: Array<[number, number]>;
  thickness: number;
  closed: boolean;
};

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isGridShapeLine(value: unknown): value is GridShapeLine {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Array.isArray((value as GridShapeLine).points);
}

/** A path with more than two points is drawn as a closed ring. */
export function gridShapePathIsClosed(path: Array<[number, number]>): boolean {
  return path.length > 2;
}

/**
 * Normalises a legacy path list or a stroke list into strokes that share one
 * bounding-box centre. An empty list throws, matching `addGridShapeLines`.
 */
export function resolveGridShapeStrokes(
  paths: GridShapePaths,
  fallbackThickness = DEFAULT_GRID_SHAPE_THICKNESS
): {strokes: ResolvedGridShapeStroke[]; center: [number, number]} {
  if (!paths.length) {
    throw new Error('addGridShapeLines requires at least one path');
  }

  let strokes: ResolvedGridShapeStroke[];
  if (isGridShapeLine(paths[0])) {
    strokes = (paths as GridShapeLine[]).map((stroke) => ({
      points: stroke.points,
      thickness: stroke.thickness ?? fallbackThickness,
      closed: stroke.closed ?? gridShapePathIsClosed(stroke.points),
    }));
  } else if (isCoordinate(paths[0])) {
    const path = paths as Array<[number, number]>;
    strokes = [
      {
        points: path,
        thickness: fallbackThickness,
        closed: gridShapePathIsClosed(path),
      },
    ];
  } else {
    strokes = (paths as Array<Array<[number, number]>>).map((path) => ({
      points: path,
      thickness: fallbackThickness,
      closed: gridShapePathIsClosed(path),
    }));
  }

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const stroke of strokes) {
    for (const [x, z] of stroke.points) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
  }
  const centerX =
    Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) / 2 : 0;
  const centerZ =
    Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) / 2 : 0;

  return {strokes, center: [centerX, centerZ]};
}

function getOrCreateGridRootContainer(
  host: any,
  deps: GridShapeDeps
): Object3D {
  const target = deps.getGridTargetObject();
  if (!target) {
    throw new Error('Target object not found for grid shape lines');
  }

  const reparentIfNeeded = (obj: Object3D) => {
    if (obj.parent !== target) {
      obj.parent?.remove(obj);
      target.add(obj);
    }
  };

  if (host[deps.gridContainerSymbol]) {
    reparentIfNeeded(host[deps.gridContainerSymbol]);
    return host[deps.gridContainerSymbol];
  }

  deps.createGrid();
  if (host[deps.gridContainerSymbol]) {
    reparentIfNeeded(host[deps.gridContainerSymbol]);
    return host[deps.gridContainerSymbol];
  }

  host[deps.gridContainerSymbol] = new Object3D();
  host[deps.gridContainerSymbol].name = 'ld-grid';
  target.add(host[deps.gridContainerSymbol]);
  return host[deps.gridContainerSymbol];
}

function getOrCreateGridShapesContainer(
  host: any,
  deps: GridShapeDeps
): Object3D {
  const gridContainer = getOrCreateGridRootContainer(host, deps);
  let shapesContainer = gridContainer.children.find(
    (child: Object3D) => child.name === GRID_SHAPES_CONTAINER_NAME
  );

  if (!shapesContainer) {
    shapesContainer = new Object3D();
    shapesContainer.name = GRID_SHAPES_CONTAINER_NAME;
    gridContainer.add(shapesContainer);
  }

  shapesContainer.visible = !!host.gridShapes;
  return shapesContainer;
}

export function setGridShapesVisible(
  host: any,
  deps: Pick<GridShapeDeps, 'gridContainerSymbol' | 'needsRenderSymbol'>,
  visible: boolean
) {
  const gridContainer = host[deps.gridContainerSymbol];
  if (!gridContainer) {
    return;
  }

  const shapesContainer = gridContainer.children.find(
    (child: Object3D) => child.name === GRID_SHAPES_CONTAINER_NAME
  );
  if (!shapesContainer) {
    return;
  }

  shapesContainer.visible = visible;
  host[deps.needsRenderSymbol]();
}

export function syncGridShapesVisibility(
  host: any,
  deps: Pick<GridShapeDeps, 'gridContainerSymbol'>
) {
  const gridContainer = host[deps.gridContainerSymbol];
  if (!gridContainer) {
    return;
  }

  const shapesContainer = gridContainer.children.find(
    (child: Object3D) => child.name === GRID_SHAPES_CONTAINER_NAME
  );
  if (!shapesContainer) {
    return;
  }

  shapesContainer.visible = !!host.gridShapes;
}

export function createPlanarStrokeGeometry(
  path: Array<[number, number]>,
  thickness: number,
  y: number,
  offsetX: number,
  offsetZ: number,
  closed: boolean
): BufferGeometry | null {
  const epsilon = 1e-6;
  const halfThickness = Math.max(thickness, epsilon) / 2;
  const points: Vector2[] = [];
  for (const [x, z] of path) {
    const point = new Vector2(x + offsetX, z + offsetZ);
    const previous = points[points.length - 1];
    if (!previous || previous.distanceTo(point) > epsilon) {
      points.push(point);
    }
  }

  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.distanceTo(last) <= epsilon) {
      points.pop();
    }
  }

  const pointCount = points.length;
  if (pointCount < 2) {
    return null;
  }

  const segmentCount = closed ? pointCount : pointCount - 1;
  const segmentNormals: Vector2[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % pointCount];
    const direction = b.clone().sub(a);
    if (direction.lengthSq() <= epsilon) {
      segmentNormals.push(new Vector2(0, 0));
      continue;
    }
    direction.normalize();
    segmentNormals.push(new Vector2(-direction.y, direction.x));
  }

  const leftRightOffsets: Vector2[] = [];
  for (let i = 0; i < pointCount; i++) {
    let offset = new Vector2(0, 0);
    if (!closed && i === 0) {
      offset = segmentNormals[0].clone().multiplyScalar(halfThickness);
    } else if (!closed && i === pointCount - 1) {
      offset = segmentNormals[segmentCount - 1]
        .clone()
        .multiplyScalar(halfThickness);
    } else {
      const prevNormal = segmentNormals[(i - 1 + segmentCount) % segmentCount];
      const nextNormal = segmentNormals[i % segmentCount];
      const miter = prevNormal.clone().add(nextNormal);
      if (miter.lengthSq() <= epsilon) {
        offset = nextNormal.clone().multiplyScalar(halfThickness);
      } else {
        miter.normalize();
        const dot = Math.max(epsilon, Math.abs(miter.dot(nextNormal)));
        const miterLength = Math.min(halfThickness / dot, halfThickness * 4);
        offset = miter.multiplyScalar(miterLength);
      }
    }
    leftRightOffsets.push(offset);
  }

  const positions: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const p = points[i];
    const offset = leftRightOffsets[i];
    positions.push(p.x + offset.x, y, p.y + offset.y);
    positions.push(p.x - offset.x, y, p.y - offset.y);
  }

  const indices: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % pointCount;
    const leftA = i * 2;
    const rightA = leftA + 1;
    const leftB = next * 2;
    const rightB = leftB + 1;
    indices.push(leftA, leftB, rightA);
    indices.push(rightA, leftB, rightB);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function addGridShapeLines(
  host: any,
  deps: GridShapeDeps,
  paths: GridShapePaths,
  options: {
    id?: string;
    color?: string | number;
    thickness?: number;
    coordinate?: [number, number];
  } = {}
): string {
  const {strokes, center} = resolveGridShapeStrokes(
    paths,
    options.thickness ?? DEFAULT_GRID_SHAPE_THICKNESS
  );
  const id = options.id ?? `ld-grid-shape-${Date.now()}-${Math.random()}`;
  const color = options.color ?? 'rgb(120, 113, 108)';
  const [sourceCenterX, sourceCenterZ] = center;

  const [targetCenterX, targetCenterZ] = options.coordinate ?? [0, 0];
  const offsetX = targetCenterX - sourceCenterX;
  const offsetZ = targetCenterZ - sourceCenterZ;
  const gridY = host[deps.sceneSymbol].boundingBox.min.y + 0.001;

  if (host._gridShapeGroupsById.has(id)) {
    host.removeGridShapeLines(id);
  }

  const shapeGroup = new Object3D();
  shapeGroup.name = `ld-grid-shape:${id}`;

  strokes.forEach((stroke) => {
    if (stroke.points.length < 2) {
      return;
    }

    const geometry = createPlanarStrokeGeometry(
      stroke.points,
      stroke.thickness,
      gridY,
      offsetX,
      offsetZ,
      stroke.closed
    );
    if (!geometry) {
      return;
    }

    const material = new MeshBasicMaterial({
      color,
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.userData.noHit = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    shapeGroup.add(mesh);
  });

  const shapesContainer = getOrCreateGridShapesContainer(host, deps);
  shapesContainer.add(shapeGroup);
  host._gridShapeGroupsById.set(id, shapeGroup);
  host[deps.needsRenderSymbol]();

  return id;
}

export function removeGridShapeLines(
  host: any,
  needsRenderSymbol: symbol,
  id: string
): boolean {
  const shapeGroup = host._gridShapeGroupsById.get(id);
  if (!shapeGroup) {
    return false;
  }

  shapeGroup.parent?.remove(shapeGroup);
  host._disposeRenderableObject(shapeGroup);
  host._gridShapeGroupsById.delete(id);
  host[needsRenderSymbol]();
  return true;
}

export function clearGridShapeLines(host: any) {
  host._gridShapeGroupsById.forEach((_group: Object3D, id: string) => {
    host.removeGridShapeLines(id);
  });
  host._gridShapeGroupsById.clear();
}
