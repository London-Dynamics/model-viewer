import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';

import { convertToMeters } from '../../utilities/ld-utils.js';

type GridDeps = {
  sceneSymbol: symbol;
  gridContainerSymbol: symbol;
  needsRenderSymbol: symbol;
  clearGrid: () => void;
};

const GRID_LINES_CONTAINER_NAME = 'ld-grid-lines';

function getOrCreateGridContainer(host: any, deps: GridDeps): Object3D | null {
  if (host[deps.gridContainerSymbol]) {
    return host[deps.gridContainerSymbol];
  }

  const targetObject = getGridTargetObject(host, deps);
  if (!targetObject) {
    return null;
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

export function getGridTargetObject(host: any, deps: GridDeps): Object3D | null {
  const scene = host[deps.sceneSymbol];
  let targetObject: Object3D | null = null;

  scene.traverse((child: Object3D) => {
    if (child.name === 'Target') {
      targetObject = child;
    }
  });

  return targetObject;
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

  const minorSpacing = convertToMeters(host.gridMinor, host.measurementUnit);
  const majorSpacing = convertToMeters(host.gridMajor, host.measurementUnit);
  const floorY = scene.boundingBox.min.y;
  const gridY = floorY + 0.001;
  const halfSize = host.gridSize / 2;

  const minorLineWidth = 0.01;
  const majorLineWidth = 0.01;
  const originLineWidth = 0.015;

  const minorMaterial = new MeshBasicMaterial({
    color: 'rgb(214, 211, 209)',
    depthTest: true,
    depthWrite: false,
  });
  const majorMaterial = new MeshBasicMaterial({
    color: 'rgb(168, 162, 158)',
    depthTest: true,
    depthWrite: false,
  });
  const originMaterial = new MeshBasicMaterial({
    color: 'rgb(120, 113, 108)',
    depthTest: true,
    depthWrite: false,
  });

  const startX = -halfSize;
  const endX = halfSize;
  const startZ = -halfSize;
  const endZ = halfSize;
  const gridLength = host.gridSize;

  const minorVerticalGeometry = new PlaneGeometry(minorLineWidth, gridLength);
  const majorVerticalGeometry = new PlaneGeometry(majorLineWidth, gridLength);
  const originVerticalGeometry = new PlaneGeometry(originLineWidth, gridLength);
  const minorHorizontalGeometry = new PlaneGeometry(gridLength, minorLineWidth);
  const majorHorizontalGeometry = new PlaneGeometry(gridLength, majorLineWidth);
  const originHorizontalGeometry = new PlaneGeometry(gridLength, originLineWidth);

  if (host.gridMinor > 0) {
    for (
      let x = Math.floor(startX / minorSpacing) * minorSpacing;
      x <= endX;
      x += minorSpacing
    ) {
      const isMajor =
        host.gridMajor > 0 &&
        Math.abs(x / majorSpacing - Math.round(x / majorSpacing)) < 1e-6;
      const isOrigin = Math.abs(x) < 1e-6;
      const material = isOrigin
        ? originMaterial
        : isMajor
          ? majorMaterial
          : minorMaterial;
      const geometry = isOrigin
        ? originVerticalGeometry
        : isMajor
          ? majorVerticalGeometry
          : minorVerticalGeometry;
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, gridY, 0);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.noHit = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      gridLinesContainer.add(mesh);
    }
  } else if (host.gridMajor > 0) {
    for (
      let x = Math.floor(startX / majorSpacing) * majorSpacing;
      x <= endX;
      x += majorSpacing
    ) {
      const isOrigin = Math.abs(x) < 1e-6;
      const geometry = isOrigin ? originVerticalGeometry : majorVerticalGeometry;
      const material = isOrigin ? originMaterial : majorMaterial;
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, gridY, 0);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.noHit = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      gridLinesContainer.add(mesh);
    }
  }

  if (host.gridMinor > 0) {
    for (
      let z = Math.floor(startZ / minorSpacing) * minorSpacing;
      z <= endZ;
      z += minorSpacing
    ) {
      const isMajor =
        host.gridMajor > 0 &&
        Math.abs(z / majorSpacing - Math.round(z / majorSpacing)) < 1e-6;
      const isOrigin = Math.abs(z) < 1e-6;
      const material = isOrigin
        ? originMaterial
        : isMajor
          ? majorMaterial
          : minorMaterial;
      const geometry = isOrigin
        ? originHorizontalGeometry
        : isMajor
          ? majorHorizontalGeometry
          : minorHorizontalGeometry;
      const mesh = new Mesh(geometry, material);
      mesh.position.set(0, gridY, z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.noHit = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      gridLinesContainer.add(mesh);
    }
  } else if (host.gridMajor > 0) {
    for (
      let z = Math.floor(startZ / majorSpacing) * majorSpacing;
      z <= endZ;
      z += majorSpacing
    ) {
      const isOrigin = Math.abs(z) < 1e-6;
      const geometry = isOrigin ? originHorizontalGeometry : majorHorizontalGeometry;
      const material = isOrigin ? originMaterial : majorMaterial;
      const mesh = new Mesh(geometry, material);
      mesh.position.set(0, gridY, z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.noHit = true;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      gridLinesContainer.add(mesh);
    }
  }

  gridContainer.add(gridLinesContainer);
  host[deps.needsRenderSymbol]();
}

export function clearGrid(host: any, deps: GridDeps) {
  host._gridShapeGroupsById.clear();
  if (!host[deps.gridContainerSymbol]) {
    return;
  }

  if (host[deps.gridContainerSymbol].parent) {
    host[deps.gridContainerSymbol].parent.remove(host[deps.gridContainerSymbol]);
  }

  host._disposeRenderableObject(host[deps.gridContainerSymbol]);
  host[deps.gridContainerSymbol] = null;
  host[deps.needsRenderSymbol]();
}
