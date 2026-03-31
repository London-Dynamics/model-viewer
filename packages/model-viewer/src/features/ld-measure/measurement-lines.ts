import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  NormalBlending,
  Object3D,
  Vector3,
} from 'three';

type MeasurementDeps = {
  sceneSymbol: symbol;
};

export function clearMeasurements(host: any, deps: MeasurementDeps, resetEverything = false) {
  if (resetEverything) {
    host._lastClickedObject = null;
  }

  const scene = host[deps.sceneSymbol];
  try {
    scene.traverse((child: Object3D) => {
      if (child.name === 'ld-measurements') {
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
  if (host._measureWidthElement) host._measureWidthElement.style.display = 'none';
  if (host._measureHeightElement) host._measureHeightElement.style.display = 'none';
  if (host._measureDepthElement) host._measureDepthElement.style.display = 'none';
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
        new Vector3(corners[0].x, corners[0].y, corners[0].z - length - margin - overshoot),
      ],
      [
        new Vector3(corners[1].x, corners[1].y, corners[1].z - gap),
        new Vector3(corners[1].x, corners[1].y, corners[1].z - length - margin - overshoot),
      ],
    ],
    [
      [
        new Vector3(corners[1].x + length + margin, corners[1].y, corners[1].z),
        new Vector3(corners[5].x + length + margin, corners[5].y, corners[5].z),
      ],
      [
        new Vector3(corners[1].x + gap, corners[1].y, corners[1].z),
        new Vector3(corners[1].x + length + margin + overshoot, corners[1].y, corners[1].z),
      ],
      [
        new Vector3(corners[5].x + gap, corners[5].y, corners[5].z),
        new Vector3(corners[5].x + length + margin + overshoot, corners[5].y, corners[5].z),
      ],
    ],
  ];
}

export function measureObject(
  host: any,
  deps: MeasurementDeps,
  object: Object3D,
  skipLastClickCheck?: boolean
) {
  const scene = host[deps.sceneSymbol];
  if (!skipLastClickCheck && object === host._lastClickedObject) {
    return;
  }
  host._lastClickedObject = object;
  host._clearMeasurements();

  const boundingBox = host._getBoundingBox(scene, object);
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

  const lineMaterial = new LineBasicMaterial({ color: 0x000000 });
  lineMaterial.transparent = true;
  lineMaterial.opacity = 1;
  lineMaterial.depthTest = false;
  lineMaterial.blending = NormalBlending;

  const objectSize = boundingBox.getSize(new Vector3());
  const minDimension = Math.min(objectSize.x, objectSize.y, objectSize.z);
  const length = minDimension > 0 ? minDimension / 10 : host._extensionLineLength;
  const margin = length / 2;
  const edgeGroups = host._getEdgeGroups(corners, length, margin, object);
  const lineParent = new Object3D();
  lineParent.name = 'ld-measurements';

  let linesParentObject: Object3D | null = null;
  const inverseMatrix = new Matrix4();
  let needsCoordinateTransform = false;

  if (object === scene) {
    scene.traverse((child: Object3D) => {
      if (child.name === 'Target') {
        linesParentObject = child;
      }
    });
  } else {
    linesParentObject = object;
    needsCoordinateTransform = true;
  }

  if (linesParentObject) {
    if (needsCoordinateTransform) {
      linesParentObject.updateWorldMatrix(true, false);
      inverseMatrix.copy(linesParentObject.matrixWorld).invert();
    }
    linesParentObject.add(lineParent);
  }

  const toLocalSpace = (point: Vector3): Vector3 =>
    needsCoordinateTransform ? point.clone().applyMatrix4(inverseMatrix) : point.clone();

  edgeGroups.forEach((group: Array<Array<Vector3>>) => {
    const lines: Line[] = [];
    group.forEach((edge) => {
      const localEdge = edge.map((point) => toLocalSpace(point));
      const geometry = new BufferGeometry().setFromPoints(localEdge);
      const line = new Line(geometry, lineMaterial);
      line.userData.noHit = true;
      line.renderOrder = 9999;
      line.visible = false;
      line.frustumCulled = false;
      lineParent.add(line);
      lines.push(line);
    });
    host._lineGroups.push({ lines });
  });

  host._updateMarkerVisibility();
  host._updateMarkerText(boundingBox, object);
}
