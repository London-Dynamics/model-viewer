import {
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';

import { convertToMeters } from '../../utilities/ld-utils.js';

type GridDeps = {
  sceneSymbol: symbol;
  gridContainerSymbol: symbol;
  needsRenderSymbol: symbol;
  clearGrid: () => void;
};

const GRID_LINES_CONTAINER_NAME = 'ld-grid-lines';

/**
 * Tailwind Stone: minor (light) → major → origin (darkest) so hierarchy reads
 * at 0.5 opacity; origin must be darker than major or it vanishes against the floor.
 */
const GRID_LINE_COLOR_MINOR = '#a8a29e'; // Tailwind Stone 400
const GRID_LINE_COLOR_MAJOR = '#57534e'; // Tailwind Stone 600
const GRID_LINE_COLOR_ORIGIN = '#3b82f6'; // Tailwind Blue 500

/**
 * Screen-space line thickness (approximate **pixels** of AA ramp along the line).
 * These multiply `fwidth` of grid-root local coords (world units per screen pixel on the floor).
 * Not WebGL `lineWidth` (unsupported for wide lines).
 *
 * If edits seem to do nothing: run `npm run build:dev` in `packages/model-viewer` and
 * hard-reload; at extreme zoom-out the width is clamped so lines do not fill a cell.
 */
const LINE_WIDTH_MINOR_PX = 1.1;
const LINE_WIDTH_MAJOR_PX = 1.5;
/** Grid lines on grid-root X=0 / Z=0 blend toward this width. */
const LINE_WIDTH_ORIGIN_GRID_PX = 3.6;
/** Horizontal-axis emphasis at grid root origin (`oPenX` / `oPenZ`) — keep well above major so origin reads when zoomed out. */
const LINE_WIDTH_ORIGIN_AXIS_PX = 2.2;
/** Overall line alpha multiplier (1 = opaque lines). */
const GRID_OPACITY = 0.5;
/** Hide minor lines when spacing projects to fewer than this many pixels. */
const MINOR_MIN_PX = 12.0;
/** Minimum fade band (world units) when radius is tiny. */
const FADE_BAND_MIN = 1e-3;

/**
 * Vertical lift of the grid above `boundingBox.min.y` so it clears the soft-shadow
 * receiver plane (see `Shadow` in ModelScene): that plane stays near the bbox foot
 * with only a tiny gap even when room shell floor meshes are hidden, which otherwise
 * causes coplanar z-fighting (often as flickering triangles along quad diagonals).
 */
function getGridLiftY(scene: {
  size: Vector3;
  boundingBox: { min: Vector3 };
}): number {
  const floorY = scene.boundingBox.min.y;
  const maxHoriz = Math.max(scene.size.x, scene.size.z, 1e-6);
  const lift = Math.max(0.006, 0.0015 * maxHoriz);
  return floorY + lift;
}

/** Grid lines are evaluated in grid-root local XZ (same frame as the legacy mesh grid). */
const GRID_VERTEX_SHADER = /* glsl */ `
uniform mat4 uWorldToGridRoot;

varying vec3 vGridRootLocal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vGridRootLocal = (uWorldToGridRoot * worldPosition).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRID_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColorMinor;
uniform vec3 uColorMajor;
uniform vec3 uColorOrigin;
uniform float uMajorSpacing;
uniform float uMinorSpacing;
uniform float uHasMinor;
uniform float uHasMajor;
uniform vec3 uBBoxMin;
uniform vec3 uBBoxMax;
uniform float uFadeBand;
uniform float uMinorLinePx;
uniform float uMajorLinePx;
uniform float uOriginGridLinePx;
uniform float uOriginAxisPx;
uniform float uGridOpacity;
uniform float uMinorMinPx;

varying vec3 vGridRootLocal;

const float AXIS_BLEND_PX = 2.0;

float boxSdf2D(vec2 p, vec2 bmin, vec2 bmax) {
  vec2 center = 0.5 * (bmin + bmax);
  vec2 halfSize = 0.5 * (bmax - bmin);
  vec2 q = abs(p - center) - halfSize;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float line1D(float coord, float spacing, float widthPx) {
  if (spacing <= 1e-8) {
    return 0.0;
  }
  float dist =
    min(fract(coord / spacing), 1.0 - fract(coord / spacing)) * spacing;
  float w = max(fwidth(coord), 1e-7) * widthPx;
  w = min(w, spacing * 0.42);
  return 1.0 - smoothstep(0.0, w, dist);
}

float originAxis1D(float coord, float widthPx) {
  float w = max(fwidth(coord), 1e-7) * widthPx;
  return 1.0 - smoothstep(0.0, w, abs(coord));
}

void main() {
  vec2 xz = vGridRootLocal.xz;

  float sdf = boxSdf2D(xz, uBBoxMin.xz, uBBoxMax.xz);
  float distOutside = max(0.0, sdf);
  float band = max(uFadeBand, 1e-6);
  float edgeFade = 1.0 - smoothstep(0.0, band, distOutside);

  float minorPx = 0.0;
  if (uHasMinor > 0.5 && uMinorSpacing > 1e-8) {
    minorPx =
      uMinorSpacing /
      max(max(fwidth(xz.x), fwidth(xz.y)), 1e-8);
  }
  float minorWeight =
    uHasMinor > 0.5 ? smoothstep(uMinorMinPx - 2.0, uMinorMinPx + 2.0, minorPx) : 0.0;

  float nearAxisX =
    1.0 -
    smoothstep(
      0.0,
      AXIS_BLEND_PX,
      abs(xz.x) / max(fwidth(xz.x), 1e-6)
    );
  float nearAxisZ =
    1.0 -
    smoothstep(
      0.0,
      AXIS_BLEND_PX,
      abs(xz.y) / max(fwidth(xz.y), 1e-6)
    );

  float penMinX = mix(uMinorLinePx, uOriginGridLinePx, nearAxisX);
  float penMinZ = mix(uMinorLinePx, uOriginGridLinePx, nearAxisZ);
  float penMajX = mix(uMajorLinePx, uOriginGridLinePx, nearAxisX);
  float penMajZ = mix(uMajorLinePx, uOriginGridLinePx, nearAxisZ);

  float lxMajor = uHasMajor > 0.5 ? line1D(xz.x, uMajorSpacing, penMajX) : 0.0;
  float lzMajor = uHasMajor > 0.5 ? line1D(xz.y, uMajorSpacing, penMajZ) : 0.0;

  float lxMin =
    uHasMinor > 0.5
      ? line1D(xz.x, uMinorSpacing, penMinX) * minorWeight
      : 0.0;
  float lzMin =
    uHasMinor > 0.5
      ? line1D(xz.y, uMinorSpacing, penMinZ) * minorWeight
      : 0.0;

  float oPenX = originAxis1D(xz.x, uOriginAxisPx);
  float oPenZ = originAxis1D(xz.y, uOriginAxisPx);

  float vLine = max(max(lxMajor, lxMin), oPenX * max(lzMajor, lzMin));
  float hLine = max(max(lzMajor, lzMin), oPenZ * max(lxMajor, lxMin));
  float lineMask = max(vLine, hLine);

  float originPick = max(
    oPenX * max(lxMajor, lxMin),
    oPenZ * max(lzMajor, lzMin)
  );
  float crossGate = min(oPenX, oPenZ);

  vec3 col = uColorMinor;
  if (crossGate > 0.2 && lineMask > 0.14) {
    col = uColorOrigin;
  } else if (originPick > 0.085) {
    col = uColorOrigin;
  } else if (max(lxMajor, lzMajor) > 0.02) {
    col = uColorMajor;
  } else {
    col = uColorMinor;
  }

  float lineStrength = lineMask * edgeFade;
  if (lineStrength < 1e-4) {
    discard;
  }

  float alpha = lineStrength * uGridOpacity;
  if (alpha < 0.001) {
    discard;
  }

  gl_FragColor = vec4(col, alpha);
}
`;

function getOrCreateGridContainer(host: any, deps: GridDeps): Object3D | null {
  const targetObject = getGridTargetObject(host, deps);
  if (!targetObject) {
    return null;
  }

  const existing = host[deps.gridContainerSymbol] as Object3D | null;
  if (existing) {
    if (existing.parent !== targetObject) {
      existing.parent?.remove(existing);
      targetObject.add(existing);
    }
    return existing;
  }

  const gridContainer = new Object3D();
  gridContainer.name = 'ld-grid';
  gridContainer.castShadow = false;
  gridContainer.receiveShadow = false;
  host[deps.gridContainerSymbol] = gridContainer;
  targetObject.add(gridContainer);
  return gridContainer;
}

function clearGridLines(host: any, deps: GridDeps) {
  const gridContainer = host[deps.gridContainerSymbol];
  if (!gridContainer) {
    return;
  }

  const gridLinesContainer = gridContainer.children.find(
    (child: Object3D) => child.name === GRID_LINES_CONTAINER_NAME
  );
  if (!gridLinesContainer) {
    return;
  }

  gridContainer.remove(gridLinesContainer);
  host._disposeRenderableObject(gridLinesContainer);
}

export function getGridTargetObject(
  host: any,
  deps: GridDeps
): Object3D | null {
  const scene = host[deps.sceneSymbol] as {
    target?: Object3D;
    traverse?: (cb: (o: Object3D) => void) => void;
  };

  // Legacy parity: last `Target` from depth-first traverse (mesh grid + scene measurements).
  let last: Object3D | null = null;
  scene?.traverse?.((child: Object3D) => {
    if (child.name === 'Target') {
      last = child;
    }
  });
  if (last) {
    return last;
  }

  if (scene?.target?.name === 'Target') {
    return scene.target;
  }
  return null;
}

function createGridShaderMaterial(params: {
  minorSpacing: number;
  majorSpacing: number;
  hasMinor: boolean;
  hasMajor: boolean;
  fadeBand: number;
  bboxMin: Vector3;
  bboxMax: Vector3;
}): ShaderMaterial {
  const minorC = new Color(GRID_LINE_COLOR_MINOR);
  const majorC = new Color(GRID_LINE_COLOR_MAJOR);
  const originC = new Color(GRID_LINE_COLOR_ORIGIN);

  return new ShaderMaterial({
    name: 'LDMeasureProceduralGrid',
    uniforms: {
      uWorldToGridRoot: { value: new Matrix4() },
      uColorMinor: { value: minorC },
      uColorMajor: { value: majorC },
      uColorOrigin: { value: originC },
      uMajorSpacing: { value: params.majorSpacing },
      uMinorSpacing: { value: params.minorSpacing },
      uHasMinor: { value: params.hasMinor ? 1 : 0 },
      uHasMajor: { value: params.hasMajor ? 1 : 0 },
      uBBoxMin: { value: params.bboxMin.clone() },
      uBBoxMax: { value: params.bboxMax.clone() },
      uFadeBand: { value: params.fadeBand },
      uMinorLinePx: { value: LINE_WIDTH_MINOR_PX },
      uMajorLinePx: { value: LINE_WIDTH_MAJOR_PX },
      uOriginGridLinePx: { value: LINE_WIDTH_ORIGIN_GRID_PX },
      uOriginAxisPx: { value: LINE_WIDTH_ORIGIN_AXIS_PX },
      uGridOpacity: { value: GRID_OPACITY },
      uMinorMinPx: { value: MINOR_MIN_PX },
    },
    vertexShader: GRID_VERTEX_SHADER,
    fragmentShader: GRID_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    // Negative offset pulls the grid slightly toward the camera vs coplanar shadow catcher.
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}

export function createGrid(host: any, deps: GridDeps) {
  const scene = host[deps.sceneSymbol];

  clearGridLines(host, deps);

  if (!host.showGrid) {
    host[deps.needsRenderSymbol]();
    return;
  }

  if (host.gridMajor <= 0 && host.gridMinor <= 0) {
    return;
  }

  const gridContainer = getOrCreateGridContainer(host, deps);
  if (!gridContainer) {
    console.warn('Target object not found for grid');
    return;
  }

  const gridLinesContainer = new Object3D();
  gridLinesContainer.name = GRID_LINES_CONTAINER_NAME;

  const hasMajor = host.gridMajor > 0;
  const hasMinor = host.gridMinor > 0;
  const majorSpacing = hasMajor
    ? convertToMeters(host.gridMajor, host.measurementUnit)
    : 1;
  const minorSpacing = hasMinor
    ? convertToMeters(host.gridMinor, host.measurementUnit)
    : majorSpacing;

  const gridY = getGridLiftY(scene);

  let fadeBand = 2 * scene.boundingSphere.radius;
  if (!Number.isFinite(fadeBand) || fadeBand <= 0) {
    fadeBand = FADE_BAND_MIN;
  } else {
    fadeBand = Math.max(fadeBand, FADE_BAND_MIN);
  }

  const bboxMin = new Vector3().copy(scene.boundingBox.min);
  const bboxMax = new Vector3().copy(scene.boundingBox.max);

  const material = createGridShaderMaterial({
    minorSpacing,
    majorSpacing,
    hasMinor,
    hasMajor,
    fadeBand,
    bboxMin,
    bboxMax,
  });

  const geometry = new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'ld-grid-procedural';
  mesh.position.set(0, gridY, 0);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(host.gridSize, host.gridSize, 1);
  mesh.userData.noHit = true;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const uWorldToGridRoot = material.uniforms.uWorldToGridRoot.value as Matrix4;
  const syncWorldToGridRootUniform = () => {
    const root = getGridTargetObject(host, deps);
    if (root) {
      uWorldToGridRoot.copy(root.matrixWorld).invert();
    }
  };
  syncWorldToGridRootUniform();
  mesh.onBeforeRender = syncWorldToGridRootUniform;

  gridLinesContainer.add(mesh);
  gridContainer.add(gridLinesContainer);
  host[deps.needsRenderSymbol]();
}

export function clearGrid(host: any, deps: GridDeps) {
  host._gridShapeGroupsById.clear();
  if (!host[deps.gridContainerSymbol]) {
    return;
  }

  if (host[deps.gridContainerSymbol].parent) {
    host[deps.gridContainerSymbol].parent.remove(
      host[deps.gridContainerSymbol]
    );
  }

  host._disposeRenderableObject(host[deps.gridContainerSymbol]);
  host[deps.gridContainerSymbol] = null;
  host[deps.needsRenderSymbol]();
}
