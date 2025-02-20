import { property } from 'lit/decorators.js';
import {
  Box3,
  BufferGeometry,
  Intersection,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Object3D,
  Scene,
  Vector3,
} from 'three';

import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import { $controls } from './controls.js';

export declare interface LDMeasureInterface {
  measure: boolean;
}

type LineGroup = {
  lines: LineSegments[];
};

export const LDMeasureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDMeasureInterface> & T => {
  class LDMeasureModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'measure' })
    measure: boolean = false;

    //private markers: Mesh[] | null = null;

    private _pointerDwn = [0, 0];
    private _pointerUp = [0, 0];
    private _lineGroups: LineGroup[] = [];
    private _lastClickedObject: Object3D | null = null;

    private _getBoundingBox(
      scene: Scene,
      clickableMeshNames: string[] = [],
      hit: Intersection | null = null
    ): Box3 {
      const boundingBox = new Box3();

      if (!clickableMeshNames || clickableMeshNames.length === 0) {
        // Case 1: clickableMeshNames is empty or undefined, measure the entire scene
        scene.traverse((object) => {
          if (object instanceof Mesh) {
            boundingBox.expandByObject(object);
          }
        });
      } else if (clickableMeshNames.includes('*') && hit) {
        // Case 2: clickableMeshNames contains ["*"], expand to the closest clicked on
        boundingBox.expandByObject(hit.object);
      } else if (hit) {
        // Case 3: clickableMeshNames has more than 0 items, expand to closest parent if exists
        let object = hit.object;
        while (object.parent) {
          if (clickableMeshNames.includes(object.name)) {
            boundingBox.setFromObject(object);
            return boundingBox;
          }
          object = object.parent;
        }
      }

      return boundingBox;
    }

    private _measureModelAtPoint(x: number, y: number) {
      const scene = this[$scene];
      const ndcCoords = scene.getNDC(x, y);
      const hit = scene.hitFromPoint(ndcCoords);

      // @ts-ignore
      const controls = this[$controls];

      if (hit && hit.object === this._lastClickedObject) {
        // Skip if the user clicked on the same object as before
        return;
      }

      if (hit) {
        // Update the last clicked object
        this._lastClickedObject = hit ? hit.object : null;

        // Remove existing line segments
        this._lineGroups.forEach((group) =>
          group.lines.forEach((line) => line.parent?.remove(line))
        );
        this._lineGroups = [];

        const lastPanState = controls.enablePan;

        controls.enablePan = false;

        const boundingBox = this._getBoundingBox(scene, ['*'], hit);

        // Get the corners of the bounding box in the global coordinate system
        const min = boundingBox.min.clone();
        const max = boundingBox.max.clone();
        const boundingBoxCorners = [
          new Vector3(min.x, min.y, min.z),
          new Vector3(max.x, min.y, min.z),

          new Vector3(max.x, max.y, min.z),
          new Vector3(min.x, max.y, min.z),

          new Vector3(min.x, min.y, max.z),
          new Vector3(max.x, min.y, max.z),

          new Vector3(max.x, max.y, max.z),
          new Vector3(min.x, max.y, max.z),
        ];

        // Transform the corners to the local coordinate system of the hit object
        const corners = boundingBoxCorners.map((corner) =>
          hit.object.worldToLocal(corner.clone())
        );

        // Create a material for the lines
        const lineMaterial = new LineBasicMaterial({ color: 0x000000 });
        lineMaterial.transparent = true;
        lineMaterial.opacity = 0.75;

        // Enable polygon offset and set the offset values
        // This to make the lines render on top of the model
        // not needed if transparent /AvG
        //lineMaterial.polygonOffset = true;
        //lineMaterial.polygonOffsetFactor = -1; // Adjust this value as needed
        //lineMaterial.polygonOffsetUnits = -1; // Adjust this value as needed

        lineMaterial.depthTest = false; // Disable depth test to make the lines render on top of the model

        // Define the length of the extension lines
        const extensionLength = 0.2; // Adjust the length as needed

        const edgeGroups = [
          [
            /* Lower north side */
            /* Dimension line, left extension, right extension */
            [
              corners[0].clone().setZ(corners[0].z - extensionLength),
              corners[1].clone().setZ(corners[1].z - extensionLength),
            ],
            [
              corners[0],
              corners[0].clone().setZ(corners[0].z - extensionLength),
            ],
            [
              corners[1],
              corners[1].clone().setZ(corners[1].z - extensionLength),
            ],
          ],
          [
            /* Lower east side */
            /* Dimension line, left extension, right extension */
            [
              corners[1].clone().setX(corners[1].x + extensionLength),
              corners[5].clone().setX(corners[5].x + extensionLength),
            ],
            [
              corners[1],
              corners[1].clone().setX(corners[1].x + extensionLength),
            ],
            [
              corners[5],
              corners[5].clone().setX(corners[5].x + extensionLength),
            ],
          ],
          [
            /* Lower south side */
            /* Dimension line, left extension, right extension */
            [
              corners[4].clone().setZ(corners[4].z + extensionLength),
              corners[5].clone().setZ(corners[5].z + extensionLength),
            ],
            [
              corners[4],
              corners[4].clone().setZ(corners[4].z + extensionLength),
            ],
            [
              corners[5],
              corners[5].clone().setZ(corners[5].z + extensionLength),
            ],
          ],
          [
            /* Lower west side */
            /* Dimension line, left extension, right extension */
            [
              corners[0].clone().setX(corners[0].x - extensionLength),
              corners[4].clone().setX(corners[4].x - extensionLength),
            ],
            [
              corners[0],
              corners[0].clone().setX(corners[0].x - extensionLength),
            ],
            [
              corners[4],
              corners[4].clone().setX(corners[4].x - extensionLength),
            ],
          ],
        ];

        edgeGroups.forEach((group) => {
          const lines: LineSegments[] = [];

          group.forEach((edge) => {
            const geometry = new BufferGeometry().setFromPoints(edge);
            const line = new LineSegments(geometry, lineMaterial);

            line.renderOrder = 9999; // Render on top of the model

            hit.object.add(line);
            lines.push(line);
          });

          this._lineGroups.push({ lines });
        });

        // Restore the pan state of the controls
        controls.enablePan = lastPanState;
      }
      this[$needsRender]();
    }

    handleClick(event: MouseEvent) {
      const { _pointerDwn, _pointerUp } = this;
      const d = Math.hypot(
        _pointerUp[0] - _pointerDwn[0],
        _pointerUp[1] - _pointerDwn[1]
      );
      /* This to allow for a small drag on sensetive input devices */
      if (d > 4) return;

      if (!!this['measure']) {
        this._measureModelAtPoint(event.clientX, event.clientY);
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('measure')) {
        console.log('measure is now', !!this['measure']);
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      this.addEventListener('pointerdown', (e) => {
        this._pointerDwn = [e.offsetX, e.offsetY];
      });
      this.addEventListener('pointerup', (e) => {
        this._pointerUp = [e.offsetX, e.offsetY];
      });
      this.addEventListener('click', this.handleClick);
    }
  }

  return LDMeasureModelViewerElement;
};
