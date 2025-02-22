import { property } from 'lit/decorators.js';
import {
  Box3,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  Object3DEventMap,
  Vector3,
} from 'three';

import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
  $container,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import { $controls } from './controls.js';
import {
  AZIMUTHAL_OCTANT_LABELS,
  HALF_PI,
  QUARTER_PI,
  TAU,
} from '../utilities/ld-utils.js';
import { ModelScene } from '../three-components/ModelScene.js';

export declare interface LDMeasureInterface {
  measure: boolean;
}

type LineGroup = {
  lines: LineSegments[];
};

const $measureWidthElement = Symbol('measureWidthElement');
const $measureHeightElement = Symbol('measureHeightElement');
const $measureDepthElement = Symbol('measureDepthElement');

export const LDMeasureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDMeasureInterface> & T => {
  class LDMeasureModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'measure' })
    measure: boolean = false;

    @property({ type: String, attribute: 'measure-objects' })
    measureObjects: string = '';

    protected [$measureWidthElement]: HTMLSpanElement | null = null;
    protected [$measureHeightElement]: HTMLSpanElement | null = null;
    protected [$measureDepthElement]: HTMLSpanElement | null = null;

    private _pointerDwn = [0, 0];
    private _pointerUp = [0, 0];
    private _lineGroups: LineGroup[] = [];
    private _lastClickedObject: Object3D | null = null;
    private _lastCameraAngle: string = '';
    private _extensionLineLength: number = 0.2;

    private _updateMarkerVisibility() {
      if (!this._lineGroups.length || !this._lastCameraAngle.length) {
        return;
      }

      this._lineGroups.forEach((group) => {
        group.lines.forEach((line) => {
          line.visible = false;
        });
      });

      const queueForVisibility = [];

      const [
        NORTH,
        EAST,
        SOUTH,
        WEST,
        NORTH_A,
        NORTH_B,
        EAST_A,
        EAST_B,
        SOUTH_A,
        SOUTH_B,
        WEST_A,
        WEST_B,
      ] = this._lineGroups;

      switch (this._lastCameraAngle) {
        case 'front':
          queueForVisibility.push(SOUTH, EAST, WEST_A);
          break;
        case 'front-right':
          queueForVisibility.push(SOUTH, EAST, NORTH_B);
          break;
        case 'right':
          queueForVisibility.push(EAST, NORTH, SOUTH_A);
          break;
        case 'back-right':
          queueForVisibility.push(EAST, NORTH, WEST_B);
          break;
        case 'back':
          queueForVisibility.push(NORTH, WEST, EAST_A);
          break;
        case 'back-left':
          queueForVisibility.push(NORTH, WEST, SOUTH_B);
          break;
        case 'left':
          queueForVisibility.push(WEST, SOUTH, NORTH_A);
          break;
        case 'front-left':
          queueForVisibility.push(SOUTH, WEST, EAST_B);
          break;
      }

      queueForVisibility.forEach((group) => {
        group.lines.forEach((line) => {
          line.visible = true;
        });
      });

      this[$needsRender]();
    }

    private _getBoundingBox(
      scene: ModelScene,

      object: Object3D<Object3DEventMap>
    ): Box3 {
      const boundingBox = new Box3();

      if (this.measureObjects.length === 0) {
        // Case 1: clickableMeshNames is empty or undefined, measure the entire scene
        return scene.boundingBox;
      } else if (this.measureObjects.includes('*')) {
        // Case 2: clickableMeshNames contains ["*"], expand to the closest clicked on
        boundingBox.expandByObject(object);
      } else {
        // Case 3: clickableMeshNames has more than 0 items, expand to closest parent if exists
        let parentObject = object;
        while (parentObject.parent) {
          if (this.measureObjects.includes(parentObject.name)) {
            boundingBox.setFromObject(parentObject);
            return boundingBox;
          }

          parentObject = parentObject.parent;
        }
        boundingBox.setFromObject(parentObject);
        return boundingBox;
      }

      return boundingBox;
    }

    private _setExtensionLineLength() {
      const scene = this[$scene];

      const size = new Vector3();
      scene.boundingBox.getSize(size);

      const max = Math.min(size.x, size.y, size.z);

      this._extensionLineLength = max / 10;
    }

    private _clearMeasurements(resetEverything = false) {
      if (resetEverything) {
        this._lastClickedObject = null;
      }

      const scene = this[$scene];

      try {
        scene.traverse((child) => {
          if (child.name === 'ld-measurements') {
            child.parent?.remove(child);
            // Throw an exception to terminate the traversal
            throw new Error('Line parent found and removed');
          }
        });
      } catch (e) {
        if ((e as Error).message !== 'Line parent found and removed') {
          throw e; // Re-throw if it's not the expected error
        }
      }

      this._lineGroups = [];
      this[$needsRender]();
    }

    private _measureObject(object: Object3D, skipLastClickCheck?: boolean) {
      // @ts-ignore
      const controls = this[$controls];
      const scene = this[$scene];

      if (!skipLastClickCheck && object === this._lastClickedObject) {
        // Skip if the user clicked on the same object as before
        return;
      }

      // Update the last clicked object
      this._lastClickedObject = object;

      this._clearMeasurements();

      const boundingBox = this._getBoundingBox(scene, object);

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
        object.worldToLocal(corner.clone())
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

      const length = this._extensionLineLength;
      const margin = length / 2; // Margin between dimensions and model.

      const edgeGroups = [
        [
          /* Lower north side */
          /* Dimension line, left extension, right extension */
          [
            corners[0].clone().setZ(corners[0].z - length - margin),
            corners[1].clone().setZ(corners[1].z - length - margin),
          ],
          [
            corners[0].clone().setZ(corners[0].z - margin),
            corners[0].clone().setZ(corners[0].z - length - margin),
          ],
          [
            corners[1].clone().setZ(corners[1].z - margin),
            corners[1].clone().setZ(corners[1].z - length - margin),
          ],
        ],
        [
          /* Lower east side */
          /* Dimension line, left extension, right extension */
          [
            corners[1].clone().setX(corners[1].x + length + margin),
            corners[5].clone().setX(corners[5].x + length + margin),
          ],
          [
            corners[1].clone().setX(corners[1].x + margin),
            corners[1].clone().setX(corners[1].x + length + margin),
          ],
          [
            corners[5].clone().setX(corners[5].x + margin),
            corners[5].clone().setX(corners[5].x + length + margin),
          ],
        ],
        [
          /* Lower south side */
          /* Dimension line, left extension, right extension */
          [
            corners[4].clone().setZ(corners[4].z + length + margin),
            corners[5].clone().setZ(corners[5].z + length + margin),
          ],
          [
            corners[4].clone().setZ(corners[4].z + margin),
            corners[4].clone().setZ(corners[4].z + length + margin),
          ],
          [
            corners[5].clone().setZ(corners[5].z + margin),
            corners[5].clone().setZ(corners[5].z + length + margin),
          ],
        ],
        [
          /* Lower west side */
          /* Dimension line, left extension, right extension */
          [
            corners[0].clone().setX(corners[0].x - length - margin),
            corners[4].clone().setX(corners[4].x - length - margin),
          ],
          [
            corners[0].clone().setX(corners[0].x - margin),
            corners[0].clone().setX(corners[0].x - length - margin),
          ],
          [
            corners[4].clone().setX(corners[4].x - margin),
            corners[4].clone().setX(corners[4].x - length - margin),
          ],
        ],
        // North Wall A
        [
          [
            corners[0].clone().setZ(corners[0].z - length - margin),
            corners[3].clone().setZ(corners[3].z - length - margin),
          ],
          [
            corners[0].clone().setZ(corners[0].z - margin),
            corners[0].clone().setZ(corners[0].z - length - margin),
          ],
          [
            corners[3].clone().setZ(corners[3].z - margin),
            corners[3].clone().setZ(corners[3].z - length - margin),
          ],
        ],
        // North Wall B
        [
          [
            corners[1].clone().setZ(corners[1].z - length - margin),
            corners[2].clone().setZ(corners[2].z - length - margin),
          ],
          [
            corners[1].clone().setZ(corners[1].z - margin),
            corners[1].clone().setZ(corners[1].z - length - margin),
          ],
          [
            corners[2].clone().setZ(corners[2].z - margin),
            corners[2].clone().setZ(corners[2].z - length - margin),
          ],
        ],
        // East Wall A
        [
          [
            corners[1].clone().setX(corners[1].x + length + margin),
            corners[2].clone().setX(corners[2].x + length + margin),
          ],
          [
            corners[1].clone().setX(corners[1].x + margin),
            corners[1].clone().setX(corners[1].x + length + margin),
          ],
          [
            corners[2].clone().setX(corners[2].x + margin),
            corners[2].clone().setX(corners[2].x + length + margin),
          ],
        ],
        // East Wall B
        [
          [
            corners[5].clone().setX(corners[5].x + length + margin),
            corners[6].clone().setX(corners[6].x + length + margin),
          ],
          [
            corners[5].clone().setX(corners[5].x + margin),
            corners[5].clone().setX(corners[5].x + length + margin),
          ],
          [
            corners[6].clone().setX(corners[6].x + margin),
            corners[6].clone().setX(corners[6].x + length + margin),
          ],
        ],
        // South Wall A
        [
          [
            corners[5].clone().setZ(corners[5].z + length + margin),
            corners[6].clone().setZ(corners[6].z + length + margin),
          ],
          [
            corners[5].clone().setZ(corners[5].z + margin),
            corners[5].clone().setZ(corners[5].z + length + margin),
          ],
          [
            corners[6].clone().setZ(corners[6].z + margin),
            corners[6].clone().setZ(corners[6].z + length + margin),
          ],
        ],
        // South Wall B
        [
          [
            corners[4].clone().setZ(corners[4].z + length + margin),
            corners[7].clone().setZ(corners[7].z + length + margin),
          ],
          [
            corners[4].clone().setZ(corners[4].z + margin),
            corners[4].clone().setZ(corners[4].z + length + margin),
          ],
          [
            corners[7].clone().setZ(corners[7].z + margin),
            corners[7].clone().setZ(corners[7].z + length + margin),
          ],
        ],
        // West Wall A
        [
          [
            corners[4].clone().setX(corners[4].x - length - margin),
            corners[7].clone().setX(corners[7].x - length - margin),
          ],
          [
            corners[4].clone().setX(corners[4].x - margin),
            corners[4].clone().setX(corners[4].x - length - margin),
          ],
          [
            corners[7].clone().setX(corners[7].x - margin),
            corners[7].clone().setX(corners[7].x - length - margin),
          ],
        ],
        [
          [
            corners[0].clone().setX(corners[0].x - length - margin),
            corners[3].clone().setX(corners[3].x - length - margin),
          ],
          [
            corners[0].clone().setX(corners[0].x - margin),
            corners[0].clone().setX(corners[0].x - length - margin),
          ],
          [
            corners[3].clone().setX(corners[3].x - margin),
            corners[3].clone().setX(corners[3].x - length - margin),
          ],
        ],
        // West Wall B
      ];

      // Create a parent object to hold the lines
      const lineParent = new Object3D();
      lineParent.name = 'ld-measurements';

      if (object === scene) {
        const target = scene.children.find((child) => child.name === 'Target');
        if (target) {
          target.add(lineParent);
        } else {
          console.warn('Target object not found in the scene.');
          scene.add(lineParent); // Fallback to adding to the scene if Target is not found
        }
      } else {
        object.add(lineParent);
      }

      edgeGroups.forEach((group) => {
        const lines: LineSegments[] = [];

        group.forEach((edge) => {
          const geometry = new BufferGeometry().setFromPoints(edge);
          const line = new LineSegments(geometry, lineMaterial);

          line.userData.noHit = true; // unique model-viewer attribute to prevent hit testing

          line.renderOrder = 9999; // Render on top of the model

          line.visible = false; // Hide the lines initially

          lineParent.add(line);
          lines.push(line);
        });

        this._lineGroups.push({ lines });
      });

      this._updateMarkerVisibility();
    }

    private _measureScene() {
      const scene = this[$scene];

      this._measureObject(scene, true);
    }

    private _measureModelAtPoint(x: number, y: number) {
      const scene = this[$scene];
      const ndcCoords = scene.getNDC(x, y);
      const hit = scene.hitFromPoint(ndcCoords);

      const object = hit?.object;

      if (object) {
        this._measureObject(object);
      }
    }

    handleCameraChange() {
      /* @ts-ignore */
      const { theta, phi } = this.getCameraOrbit();

      const azimuthalOctant =
        (8 + Math.floor(((theta % TAU) + QUARTER_PI / 2) / (HALF_PI / 2))) % 8;

      const azimuthalOctantLabel = AZIMUTHAL_OCTANT_LABELS[azimuthalOctant];

      if (this._lastCameraAngle !== azimuthalOctantLabel) {
        this._lastCameraAngle = azimuthalOctantLabel;

        this._updateMarkerVisibility();
      }
    }

    handleClick(event: MouseEvent) {
      const { _pointerDwn, _pointerUp } = this;
      const d = Math.hypot(
        _pointerUp[0] - _pointerDwn[0],
        _pointerUp[1] - _pointerDwn[1]
      );
      /* This to allow for a small drag on sensetive input devices */
      if (d > 4) return;

      if (!!this['measure'] && this.measureObjects.length > 0) {
        this._measureModelAtPoint(event.clientX, event.clientY);
      }
    }

    handleLoad() {
      this._setExtensionLineLength();

      this._clearMeasurements();

      // If we already had something selected, make sure the measurements are updated and visible.
      if (!!this['measure']) {
        if (!this.measureObjects.length) {
          this._measureScene();
        } else if (this._lastClickedObject) {
          this._measureObject(this._lastClickedObject, true);
        }
      }
    }

    private handleNewAttributes() {
      this._clearMeasurements(true);

      if (!this.measureObjects.length && !!this['measure']) {
        this._measureScene();
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (
        changedProperties.has('measure') ||
        changedProperties.has('measureObjects')
      ) {
        this.handleNewAttributes();
      }
    }

    connectedCallback() {
      super.connectedCallback();

      this.addEventListener('camera-change', this.handleCameraChange);

      this.addEventListener('load', this.handleLoad);

      const container = this.shadowRoot?.querySelector('.container');

      console.log('container A', container);

      console.log('container B', this[$container]);
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this.removeEventListener('camera-change', this.handleCameraChange);

      this.removeEventListener('load', this.handleLoad);
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
