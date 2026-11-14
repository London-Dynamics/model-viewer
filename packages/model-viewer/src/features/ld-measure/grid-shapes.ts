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

const ENDPOINT_EPSILON = 1e-6;

export type GridShapeJoint = {
  center: [number, number];
  thickness: number;
};

type StrokeEnd = {
  strokeIndex: number;
  /** 0 is the first point, 1 is the last. */
  end: 0 | 1;
  point: [number, number];
};

type ChainItem = {
  index: number;
  reversed: boolean;
};

function pointsMatch(a: [number, number], b: [number, number]): boolean {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return dx * dx + dz * dz <= ENDPOINT_EPSILON * ENDPOINT_EPSILON;
}

function sameThickness(a: number, b: number): boolean {
  return Math.abs(a - b) <= ENDPOINT_EPSILON;
}

function endKey(end: StrokeEnd): string {
  return `${end.strokeIndex}:${end.end}`;
}

function orientedPoints(
  points: Array<[number, number]>,
  reversed: boolean
): Array<[number, number]> {
  const copy = points.map((point) => [point[0], point[1]] as [number, number]);
  if (reversed) {
    copy.reverse();
  }
  return copy;
}

/** Distinct corners, dropping a closing point that repeats the start. */
function polylineVertexCount(points: Array<[number, number]>): number {
  const vertices: Array<[number, number]> = [];
  for (const point of points) {
    const previous = vertices[vertices.length - 1];
    if (!previous || !pointsMatch(previous, point)) {
      vertices.push(point);
    }
  }
  if (
    vertices.length > 1 &&
    pointsMatch(vertices[0], vertices[vertices.length - 1])
  ) {
    vertices.pop();
  }
  return vertices.length;
}

function chainStartEnd(item: ChainItem): 0 | 1 {
  return item.reversed ? 1 : 0;
}

function chainFinishEnd(item: ChainItem): 0 | 1 {
  return item.reversed ? 0 : 1;
}

/**
 * Joins open strokes in one shape that share an endpoint and thickness.
 * Two ends become one polyline so the existing miter can draw the corner.
 * A loop of three or more corners is closed. Three or more ends stay
 * separate and record a joint disc. A stroke is not closed only because
 * its own ends meet.
 */
export function joinCoincidentGridStrokes(
  strokes: ResolvedGridShapeStroke[]
): {strokes: ResolvedGridShapeStroke[]; joints: GridShapeJoint[]} {
  const endpoints: StrokeEnd[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.closed || stroke.points.length < 2) {
      continue;
    }
    endpoints.push({strokeIndex: i, end: 0, point: stroke.points[0]});
    endpoints.push({
      strokeIndex: i,
      end: 1,
      point: stroke.points[stroke.points.length - 1],
    });
  }

  const links = new Map<string, StrokeEnd>();
  const joints: GridShapeJoint[] = [];
  const consumed: boolean[] = new Array(endpoints.length).fill(false);

  for (let i = 0; i < endpoints.length; i++) {
    if (consumed[i]) {
      continue;
    }
    const cluster: StrokeEnd[] = [endpoints[i]];
    consumed[i] = true;
    for (let j = i + 1; j < endpoints.length; j++) {
      if (consumed[j]) {
        continue;
      }
      const seed = endpoints[i];
      const other = endpoints[j];
      if (
        !sameThickness(
          strokes[seed.strokeIndex].thickness,
          strokes[other.strokeIndex].thickness
        ) ||
        !pointsMatch(seed.point, other.point)
      ) {
        continue;
      }
      cluster.push(other);
      consumed[j] = true;
    }

    if (
      cluster.length === 2 &&
      cluster[0].strokeIndex !== cluster[1].strokeIndex
    ) {
      links.set(endKey(cluster[0]), cluster[1]);
      links.set(endKey(cluster[1]), cluster[0]);
    } else if (cluster.length >= 3) {
      joints.push({
        center: [cluster[0].point[0], cluster[0].point[1]],
        thickness: strokes[cluster[0].strokeIndex].thickness,
      });
    }
  }

  const result: ResolvedGridShapeStroke[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (stroke.closed || stroke.points.length < 2) {
      result.push(stroke);
      visited.add(i);
      continue;
    }
    if (visited.has(i)) {
      continue;
    }

    const chain: ChainItem[] = [{index: i, reversed: false}];
    const inChain = new Set<number>([i]);
    visited.add(i);
    let looped = false;

    for (let step = 0; step < strokes.length; step++) {
      const head = chain[0];
      const link = links.get(`${head.index}:${chainStartEnd(head)}`);
      if (!link || inChain.has(link.strokeIndex)) {
        looped = link != null && inChain.has(link.strokeIndex);
        break;
      }
      inChain.add(link.strokeIndex);
      visited.add(link.strokeIndex);
      chain.unshift({index: link.strokeIndex, reversed: link.end === 0});
    }

    if (!looped) {
      for (let step = 0; step < strokes.length; step++) {
        const tail = chain[chain.length - 1];
        const link = links.get(`${tail.index}:${chainFinishEnd(tail)}`);
        if (!link || inChain.has(link.strokeIndex)) {
          looped = link != null && inChain.has(link.strokeIndex);
          break;
        }
        inChain.add(link.strokeIndex);
        visited.add(link.strokeIndex);
        chain.push({index: link.strokeIndex, reversed: link.end === 1});
      }
    }

    if (chain.length === 1) {
      result.push(stroke);
      continue;
    }

    const points: Array<[number, number]> = [];
    for (const item of chain) {
      const part = orientedPoints(strokes[item.index].points, item.reversed);
      if (points.length === 0) {
        points.push(...part);
      } else {
        points.push(...part.slice(1));
      }
    }

    if (looped && polylineVertexCount(points) < 3) {
      for (const item of chain) {
        result.push(strokes[item.index]);
      }
      continue;
    }

    result.push({
      points,
      thickness: stroke.thickness,
      closed: looped,
    });
  }

  return {strokes: result, joints};
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

/** Filled disc that covers butts where three or more strokes meet. */
export function createPlanarJointGeometry(
  center: [number, number],
  thickness: number,
  y: number,
  offsetX: number,
  offsetZ: number
): BufferGeometry {
  const epsilon = 1e-6;
  const radius = Math.max(thickness, epsilon) / 2;
  const segments = 16;
  const cx = center[0] + offsetX;
  const cz = center[1] + offsetZ;
  const positions: number[] = [cx, y, cz];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(
      cx + Math.cos(angle) * radius,
      y,
      cz + Math.sin(angle) * radius
    );
  }

  const indices: number[] = [];
  for (let i = 1; i <= segments; i++) {
    // Winding faces +Y, matching the stroke quads viewed from above.
    indices.push(0, i + 1, i);
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
  const resolved = resolveGridShapeStrokes(
    paths,
    options.thickness ?? DEFAULT_GRID_SHAPE_THICKNESS
  );
  const {strokes, joints} = joinCoincidentGridStrokes(resolved.strokes);
  const center = resolved.center;
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

  for (const joint of joints) {
    const geometry = createPlanarJointGeometry(
      joint.center,
      joint.thickness,
      gridY,
      offsetX,
      offsetZ
    );
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
  }

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
