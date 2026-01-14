import { property } from 'lit/decorators.js';
import {
  Box3,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Object3D,
  Object3DEventMap,
  Vector3,
} from 'three';

import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import { $controls } from './controls.js';
import {
  LDSelectionMixin,
  SelectionChangeDetail,
  SelectionScope,
} from './ld-selection/index.js';
import {
  AZIMUTHAL_OCTANT_LABELS,
  convertMeters,
  HALF_PI,
  QUARTER_PI,
  TAU,
} from '../utilities/ld-utils.js';
import { ModelScene } from '../three-components/ModelScene.js';

export declare interface LDMeasureInterface {
  measure: boolean;
}

type LineGroup = {
  lines: Line[];
};

const $measureContainer = Symbol('measureContainer');

export const LDMeasureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDMeasureInterface> & T => {
  // Apply the selection mixin first so we have access to selectionScope and selection events
  const SelectionBase = LDSelectionMixin(ModelViewerElement);

  class LDMeasureModelViewerElement extends SelectionBase {
    @property({ type: Boolean, attribute: 'measure' })
    measure: boolean = false;

    @property({ type: String, attribute: 'measurement-unit' })
    measurementUnit: string = 'm';

    @property({ type: String, attribute: 'measurement-precision' })
    measurementPrecision: number = 2;

    @property({ type: String, attribute: 'measurement-overrides' })
    measurementOverrides: string = '';

    @property({ type: String, attribute: 'grid' })
    showGrid: boolean = false;

    @property({ type: String, attribute: 'grid-major-step' })
    gridMajor: number = 1;

    @property({ type: String, attribute: 'grid-minor-step' })
    gridMinor: number = 0.5;

    @property({ type: Boolean, attribute: 'disable-measurement-lines' })
    disableMeasurementLines: boolean = false;

    protected [$measureContainer]: HTMLElement = this.shadowRoot!.querySelector(
      '.slot.ld-measure'
    ) as HTMLElement;

    protected _measureWidthElement: HTMLElement | null = null;
    protected _measureHeightElement: HTMLElement | null = null;
    protected _measureDepthElement: HTMLElement | null = null;

    private _widthElementAnchorIndex: number = -1;
    private _heightElementAnchorIndex: number = -1;
    private _depthElementAnchorIndex: number = -1;

    private _lineGroups: LineGroup[] = [];
    private _lastClickedObject: Object3D | null = null;
    private _lastCameraAngle: string = '';
    private _extensionLineLength: number = 0.2;

    private _worldToScreen(position: Vector3): { x: number; y: number } {
      const width = this[$scene].width;
      const height = this[$scene].height;

      const vector = position.clone().project(this[$scene].camera);

      return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (vector.y * -0.5 + 0.5) * height,
      };
    }

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
        NORTH, // 0
        EAST, // 1
        SOUTH, // 2
        WEST, // 3
        NORTH_A, // 4
        NORTH_B, // 5

        EAST_A, // 6
        EAST_B, // 7
        SOUTH_A, // 8
        SOUTH_B, // 9
        WEST_A, // 10
        WEST_B, // 11
      ] = this._lineGroups;

      switch (this._lastCameraAngle) {
        case 'front':
          queueForVisibility.push(SOUTH, WEST_A, EAST);
          this._widthElementAnchorIndex = 2;
          this._heightElementAnchorIndex = 10;
          this._depthElementAnchorIndex = 1;
          break;
        case 'front-right':
          queueForVisibility.push(SOUTH, NORTH_B, EAST);
          this._widthElementAnchorIndex = 2;
          this._heightElementAnchorIndex = 5;
          this._depthElementAnchorIndex = 1;
          break;
        case 'right':
          queueForVisibility.push(NORTH, SOUTH_A, EAST);
          this._widthElementAnchorIndex = 0;
          this._heightElementAnchorIndex = 8;
          this._depthElementAnchorIndex = 1;
          break;
        case 'back-right':
          queueForVisibility.push(NORTH, WEST_B, EAST);
          this._widthElementAnchorIndex = 0;
          this._heightElementAnchorIndex = 11;
          this._depthElementAnchorIndex = 1;
          break;
        case 'back':
          queueForVisibility.push(NORTH, EAST_A, WEST);
          this._widthElementAnchorIndex = 0;
          this._heightElementAnchorIndex = 6;
          this._depthElementAnchorIndex = 3;
          break;
        case 'back-left':
          queueForVisibility.push(NORTH, SOUTH_B, WEST);
          this._widthElementAnchorIndex = 0;
          this._heightElementAnchorIndex = 9;
          this._depthElementAnchorIndex = 3;
          break;
        case 'left':
          queueForVisibility.push(SOUTH, NORTH_A, WEST);
          this._widthElementAnchorIndex = 2;
          this._heightElementAnchorIndex = 4;
          this._depthElementAnchorIndex = 3;
          break;
        case 'front-left':
          queueForVisibility.push(SOUTH, EAST_B, WEST);
          this._widthElementAnchorIndex = 2;
          this._heightElementAnchorIndex = 7;
          this._depthElementAnchorIndex = 3;
          break;
      }

      if (!this.disableMeasurementLines) {
        queueForVisibility.forEach((group) => {
          group.lines.forEach((line) => {
            line.visible = true;
          });
        });
      }

      this._updateMarkerPosition();
      this[$needsRender]();
    }

    private _parseMeasurementOverrides(): Array<{
      w: number;
      h: number;
      d: number;
    }> {
      if (!this.measurementOverrides) {
        return [];
      }

      return this.measurementOverrides
        .split(',')
        .map((set) => {
          const [w, h, d] = set.trim().split(' ').map(Number);

          return { w, h, d };
        })
        .filter((set) => set.w && set.h && set.d);
    }

    private _updateMarkerText(boundingBox: Box3, object: Object3D) {
      if (
        !this._measureWidthElement ||
        !this._measureHeightElement ||
        !this._measureDepthElement
      ) {
        return;
      }

      const scene = this[$scene];

      const unit = this.measurementUnit;
      const precision = this.measurementPrecision;

      const overrides = this._parseMeasurementOverrides();

      function getPureOrOverriddenValues() {
        const size = boundingBox.getSize(new Vector3());

        // If we have overrides, use the first one (for scene measurements)
        if (overrides.length && object === scene) {
          return [overrides[0].w, overrides[0].h, overrides[0].d];
        }

        return [size.x, size.y, size.z];
      }

      const [width, height, depth] = getPureOrOverriddenValues();

      let value: string | null = null;

      value = convertMeters(width, unit, precision);
      this._measureWidthElement.textContent = value;
      this._measureWidthElement.style.display = 'block';
      this._measureWidthElement.setAttribute('aria-label', `Width: ${value}`);

      value = convertMeters(height, unit, precision);
      this._measureHeightElement.textContent = value;
      this._measureHeightElement.style.display = 'block';
      this._measureHeightElement.setAttribute('aria-label', `Height: ${value}`);

      value = convertMeters(depth, unit, precision);
      this._measureDepthElement.textContent = value;
      this._measureDepthElement.style.display = 'block';
      this._measureDepthElement.setAttribute('aria-label', `Depth: ${value}`);
    }

    private _updateMarkerPosition() {
      if (
        this._widthElementAnchorIndex === -1 ||
        this._heightElementAnchorIndex === -1 ||
        this._depthElementAnchorIndex === -1
      ) {
        return;
      }

      if (!this._lineGroups.length) {
        return;
      }

      const sceneWidth = this[$scene].width;

      if (this._widthElementAnchorIndex !== -1 && this._measureWidthElement) {
        const line = this._lineGroups[this._widthElementAnchorIndex].lines[0];
        const midPoint = new Vector3();
        line.geometry.computeBoundingBox();
        line.geometry.boundingBox?.getCenter(midPoint);
        line.localToWorld(midPoint);

        const screenPosition = this._worldToScreen(midPoint);
        const elementWidth = this._measureWidthElement.offsetWidth / 2;
        screenPosition.x = Math.max(
          elementWidth,
          Math.min(screenPosition.x, sceneWidth - elementWidth)
        );

        this._measureWidthElement?.setAttribute(
          'style',
          `left: ${screenPosition.x}px; top: ${screenPosition.y}px; transform: translate(-50%, -50%);`
        );
      } else {
        this._measureWidthElement?.setAttribute('style', 'display: none;');
      }
      if (this._heightElementAnchorIndex !== -1 && this._measureHeightElement) {
        const line = this._lineGroups[this._heightElementAnchorIndex].lines[0];
        const midPoint = new Vector3();
        line.geometry.computeBoundingBox();
        line.geometry.boundingBox?.getCenter(midPoint);
        line.localToWorld(midPoint);

        const screenPosition = this._worldToScreen(midPoint);

        const elementWidth = this._measureHeightElement.offsetWidth / 2;
        screenPosition.x = Math.max(
          elementWidth,
          Math.min(screenPosition.x, sceneWidth - elementWidth)
        );

        this._measureHeightElement?.setAttribute(
          'style',
          `left: ${screenPosition.x}px; top: ${screenPosition.y}px; transform: translate(-50%, -50%);`
        );
      } else {
        this._measureHeightElement?.setAttribute('style', 'display: none;');
      }
      if (this._depthElementAnchorIndex !== -1 && this._measureDepthElement) {
        const line = this._lineGroups[this._depthElementAnchorIndex].lines[0];
        const midPoint = new Vector3();
        line.geometry.computeBoundingBox();
        line.geometry.boundingBox?.getCenter(midPoint);
        line.localToWorld(midPoint);

        const screenPosition = this._worldToScreen(midPoint);

        const elementWidth = this._measureDepthElement.offsetWidth / 2;
        screenPosition.x = Math.max(
          elementWidth,
          Math.min(screenPosition.x, sceneWidth - elementWidth)
        );

        this._measureDepthElement?.setAttribute(
          'style',
          `left: ${screenPosition.x}px; top: ${screenPosition.y}px; transform: translate(-50%, -50%);`
        );
      } else {
        this._measureDepthElement?.setAttribute('style', 'display: none;');
      }
    }

    private _getBoundingBox(
      scene: ModelScene,
      object: Object3D<Object3DEventMap>
    ): Box3 {
      const boundingBox = new Box3();

      // If measuring the scene itself, return the scene's bounding box
      if (object === scene) {
        return scene.boundingBox;
      }

      // Otherwise, compute the bounding box of the selected object
      boundingBox.expandByObject(object);
      return boundingBox;
    }

    private _setExtensionLineLength() {
      const scene = this[$scene];

      const size = new Vector3();
      scene.boundingBox.getSize(size);

      const min = Math.min(size.x, size.y, size.z);

      this._extensionLineLength = min / 10;
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
      if (this._measureWidthElement)
        this._measureWidthElement.style.display = 'none';
      if (this._measureHeightElement)
        this._measureHeightElement.style.display = 'none';
      if (this._measureDepthElement)
        this._measureDepthElement.style.display = 'none';

      this[$needsRender]();
    }

    private _getEdgeGroups(
      _corners: Vector3[],
      length: number,
      margin: number,
      object: Object3D
    ) {
      const corners = _corners.map((corner) =>
        corner.clone().applyMatrix4(object.matrixWorld)
      );

      return [
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
        // West Wall B
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
      ];
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

      if (
        boundingBox.min.equals(new Vector3(Infinity, Infinity, Infinity)) ||
        boundingBox.max.equals(new Vector3(-Infinity, -Infinity, -Infinity))
      ) {
        console.warn('Bounding box is empty.');
        return;
      }

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

      const corners = boundingBoxCorners.map((corner) =>
        object.worldToLocal(corner.clone())
      );

      // Create a material for the lines
      const lineMaterial = new LineBasicMaterial({ color: 0x000000 });
      lineMaterial.transparent = true;
      lineMaterial.opacity = 0.75;
      lineMaterial.depthTest = false; // Disable depth test to make the lines render on top of the model

      const length = this._extensionLineLength;
      const margin = length / 2; // Margin between dimensions and model.

      const edgeGroups = this._getEdgeGroups(corners, length, margin, object);

      // Create a parent object to hold the lines
      const lineParent = new Object3D();
      lineParent.name = 'ld-measurements';

      // Apply the inverse transformation to lineParent
      const inverseMatrix = new Matrix4().copy(object.matrixWorld).invert();
      lineParent.applyMatrix4(inverseMatrix);

      if (object === scene) {
        let targetObject: Object3D | undefined;

        try {
          scene.traverse((child) => {
            if (child.name === 'Target') {
              targetObject = child;
              throw new Error('found target object'); // Stop traversal when found
            }
          });
        } catch (e) {
          if ((e as Error).message !== 'found target object') throw e;
        }

        if (targetObject) {
          targetObject.add(lineParent);
        } else {
          console.warn('Target object not found in the scene.');
          scene.add(lineParent); // Fallback to adding to the scene if Target is not found
        }
      } else {
        object.add(lineParent);
      }

      edgeGroups.forEach((group) => {
        const lines: Line[] = [];

        group.forEach((edge) => {
          const geometry = new BufferGeometry().setFromPoints(edge);
          const line = new Line(geometry, lineMaterial);

          line.userData.noHit = true; // unique model-viewer attribute to prevent hit testing

          line.renderOrder = 9999; // Render on top of the model

          line.visible = false; // Hide the lines initially

          lineParent.add(line);
          lines.push(line);
        });

        this._lineGroups.push({ lines });
      });

      this._updateMarkerVisibility();
      this._updateMarkerText(boundingBox, object);
    }

    private _measureScene() {
      const scene = this[$scene];

      this._measureObject(scene, true);
    }

    private _handleCameraChange() {
      /* @ts-ignore */
      const { theta, phi } = this.getCameraOrbit();

      const azimuthalOctant =
        (8 + Math.floor(((theta % TAU) + QUARTER_PI / 2) / (HALF_PI / 2))) % 8;

      const azimuthalOctantLabel = AZIMUTHAL_OCTANT_LABELS[azimuthalOctant];

      if (this._lastCameraAngle !== azimuthalOctantLabel) {
        this._lastCameraAngle = azimuthalOctantLabel;

        this._updateMarkerVisibility();
      }

      this._updateMarkerPosition();
    }

    private _onSelectionChange = (event: Event) => {
      const customEvent = event as CustomEvent<SelectionChangeDetail>;
      const { selectedObjects, type } = customEvent.detail;

      // Only respond to selection changes when measure is enabled
      if (!this.measure) {
        return;
      }

      // If selection-scope is 'scene', we always measure the scene (handled in handleNewAttributes)
      if ((this as any).selectionScope === 'scene') {
        return;
      }

      // Handle selection changes for part/group/all modes
      if (type === 'clear' || selectedObjects.length === 0) {
        this._clearMeasurements(true);
        return;
      }

      // Measure the first selected object
      if (selectedObjects.length > 0) {
        this._measureObject(selectedObjects[0], true);
      }
    };

    private _onObjectDrag = (event: Event) => {
      // Update marker positions when the object being measured is dragged
      if (!this.measure || !this._lastClickedObject) {
        return;
      }

      const customEvent = event as CustomEvent<{
        object: Object3D;
        position: Vector3;
      }>;
      const { object } = customEvent.detail;

      // Check if the dragged object is the one we're measuring, or if it's a parent/child
      const scene = this[$scene];
      const measuredObject = this._lastClickedObject;

      // Update if we're measuring the dragged object, its parent group, or the scene
      const shouldUpdate =
        measuredObject === object ||
        measuredObject === scene ||
        object.parent === measuredObject ||
        measuredObject.parent === object;

      if (shouldUpdate) {
        this._updateMarkerPosition();
      }
    };

    private _modelLoaded = false;

    private _handleProgress(event: Event) {
      const progress = (event as any).detail.totalProgress;
      const reason = (event as any).detail.reason;

      if (this._modelLoaded && reason === 'model-load' && progress < 1) {
        this._modelLoaded = false;
      }
    }

    private _handleLoad() {
      this._modelLoaded = true;

      this._setExtensionLineLength();

      this.handleNewAttributes();
    }

    private handleNewAttributes(resetEverything = false) {
      this._clearMeasurements(resetEverything);

      const enabled = !!this['measure'];
      const scope = (this as any).selectionScope as SelectionScope;

      if (enabled) {
        this._handleCameraChange();

        // If selection-scope is 'scene', measure the entire scene
        if (scope === 'scene') {
          this._measureScene();
        } else {
          // For part/group/all modes, measure whatever is currently selected
          const selectedObjects = (this as any).getSelectedObjects?.() || [];
          if (selectedObjects.length > 0) {
            this._measureObject(selectedObjects[0], true);
          }
          // If nothing is selected, wait for user to click (selection will trigger _onSelectionChange)
        }
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (this._modelLoaded) {
        if (
          changedProperties.has('measure') ||
          changedProperties.has('selectionScope')
        ) {
          this.handleNewAttributes(true);
        } else if (
          (changedProperties.has('disableMeasurementLines') ||
            changedProperties.has('measurementUnit') ||
            changedProperties.has('measurementPrecision') ||
            changedProperties.has('measurementOverrides')) &&
          !!this['measure']
        ) {
          this.handleNewAttributes();
        }
      }
    }

    connectedCallback() {
      super.connectedCallback();

      this.addEventListener('camera-change', this._handleCameraChange);
      this.addEventListener('load', this._handleLoad);
      this.addEventListener('progress', this._handleProgress);
      this.addEventListener(
        'selection-change',
        this._onSelectionChange as EventListener
      );
      this.addEventListener('object-drag', this._onObjectDrag as EventListener);

      const shadowRoot = this.shadowRoot;

      if (shadowRoot) {
        const measureWidthSlot = shadowRoot.querySelector(
          'slot[name="ruler-width"]'
        ) as HTMLSlotElement;
        const measureHeightSlot = shadowRoot.querySelector(
          'slot[name="ruler-height"]'
        ) as HTMLSlotElement;
        const measureDepthSlot = shadowRoot.querySelector(
          'slot[name="ruler-depth"]'
        ) as HTMLSlotElement;

        if (measureWidthSlot) {
          const assignedNodes = measureWidthSlot.assignedNodes({
            flatten: true,
          });
          this._measureWidthElement = assignedNodes.find(
            (node) => node.nodeType === Node.ELEMENT_NODE
          ) as HTMLSpanElement;
        }

        if (measureHeightSlot) {
          const assignedNodes = measureHeightSlot.assignedNodes({
            flatten: true,
          });
          this._measureHeightElement = assignedNodes.find(
            (node) => node.nodeType === Node.ELEMENT_NODE
          ) as HTMLSpanElement;
        }

        if (measureDepthSlot) {
          const assignedNodes = measureDepthSlot.assignedNodes({
            flatten: true,
          });
          this._measureDepthElement = assignedNodes.find(
            (node) => node.nodeType === Node.ELEMENT_NODE
          ) as HTMLSpanElement;
        }
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this.removeEventListener('camera-change', this._handleCameraChange);
      this.removeEventListener('load', this._handleLoad);
      this.removeEventListener('progress', this._handleProgress);
      this.removeEventListener(
        'selection-change',
        this._onSelectionChange as EventListener
      );
      this.removeEventListener(
        'object-drag',
        this._onObjectDrag as EventListener
      );

      this._measureWidthElement = null;
      this._measureHeightElement = null;
      this._measureDepthElement = null;
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      // Note: Event listeners are now managed by _enableMeasurementListeners()
      // and _disableMeasurementListeners() based on the measure attribute state.
      // This ensures measurements only activate when measure={true}
    }
  }

  return LDMeasureModelViewerElement;
};
