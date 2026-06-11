import { property } from 'lit/decorators.js';
import {
  Box3,
  BufferGeometry,
  Line,
  Mesh,
  Object3D,
  Object3DEventMap,
  Vector3,
} from 'three';

import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
  $tick,
} from '../../model-viewer-base.js';
import { createGrid, clearGrid, getGridTargetObject } from './grid.js';
import {
  addGridShapeLines as addGridShapeLinesImpl,
  createPlanarStrokeGeometry as createPlanarStrokeGeometryImpl,
  clearGridShapeLines as clearGridShapeLinesImpl,
  removeGridShapeLines as removeGridShapeLinesImpl,
  setGridShapesVisible as setGridShapesVisibleImpl,
  syncGridShapesVisibility as syncGridShapesVisibilityImpl,
} from './grid-shapes.js';
import {
  clearMeasurements as clearMeasurementsImpl,
  getViewOctantLabelInSpace,
  measureObject as measureObjectImpl,
  measureObjects as measureObjectsImpl,
  syncMeasurementTransform as syncMeasurementTransformImpl,
} from './measurement-lines.js';
import {
  SELECTION_TRANSFORM_PIVOT_UUID,
  type TransformEventDetail,
} from '../ld-modular/transform-events.js';

import { Constructor } from '../../utilities.js';
import { SelectionChangeDetail, SelectionScope } from '../ld-selection/index.js';
import {
  AZIMUTHAL_OCTANT_LABELS,
  formatMetersWithUnit,
  HALF_PI,
  QUARTER_PI,
  TAU,
} from '../../utilities/ld-utils.js';
import { ModelScene } from '../../three-components/ModelScene.js';

export declare interface LDMeasureInterface {
  measure: boolean;
  gridShapes: boolean;
  addGridShapeLines(
    paths: Array<Array<[number, number]>> | Array<[number, number]>,
    options?: {
      id?: string;
      color?: string | number;
      thickness?: number;
      coordinate?: [number, number];
    }
  ): string;
  removeGridShapeLines(id: string): boolean;
}

type LineGroup = {
  lines: Line[];
};

const $measureContainer = Symbol('measureContainer');
const $gridContainer = Symbol('gridContainer');

export const LDMeasureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDMeasureInterface> & T => {
  // LDModularMixin (which this wraps) already applies LDSelectionMixin,
  // so we inherit selection functionality without reapplying it
  class LDMeasureModelViewerElement extends ModelViewerElement {
    private _touchExtractedMembers() {
      void this._gridShapeGroupsById;
      void this._extensionLineLength;
      void this._updateMarkerText;
      void this._getBoundingBox;
      void this._disposeRenderableObject;
      void this._createPlanarStrokeGeometry;
      void this._getEdgeGroups;
    }

    @property({ type: Boolean, attribute: 'measure' })
    measure: boolean = false;

    @property({ type: String, attribute: 'measurement-unit' })
    measurementUnit: string = 'm';

    @property({ type: String, attribute: 'measurement-precision' })
    measurementPrecision: number = 2;

    @property({ type: String, attribute: 'measurement-overrides' })
    measurementOverrides: string = '';

    @property({ type: Boolean, attribute: 'grid' })
    showGrid: boolean = false;

    @property({ type: Number, attribute: 'grid-size' })
    gridSize: number = 100;

    @property({ type: Number, attribute: 'grid-major-step' })
    gridMajor: number = 1;

    @property({ type: Number, attribute: 'grid-minor-step' })
    gridMinor: number = 0.5;

    @property({ type: Boolean, attribute: 'grid-shapes' })
    gridShapes: boolean = false;

    @property({ type: Boolean, attribute: 'disable-measurement-lines' })
    disableMeasurementLines: boolean = false;

    protected [$measureContainer]: HTMLElement = this.shadowRoot!.querySelector(
      '.slot.ld-measure'
    ) as HTMLElement;

    protected [$gridContainer]: Object3D | null = null;

    protected _measureWidthElement: HTMLElement | null = null;
    protected _measureHeightElement: HTMLElement | null = null;
    protected _measureDepthElement: HTMLElement | null = null;

    private _widthElementAnchorIndex: number = -1;
    private _heightElementAnchorIndex: number = -1;
    private _depthElementAnchorIndex: number = -1;

    private _lineGroups: LineGroup[] = [];
    private _gridShapeGroupsById: Map<string, Object3D> = new Map();
    protected _measuredObjects: Object3D[] = [];
    protected _measuredSelectionKey: string = '';
    protected _measurementFrame: Object3D | null = null;
    protected _measurementSpace: Object3D | null = null;
    protected _measurementUsesWorldAabbFallback: boolean = false;
    protected _measurementFrameBaseRotationY: number = 0;
    private _lastCameraAngle: string = '';
    private _extensionLineLength: number = 0.2;
    private _cameraWorldPosition: Vector3 = new Vector3();

    private _boundSelectionChangeHandler?: (event: Event) => void;

    private _worldToScreen(position: Vector3): { x: number; y: number } {
      const width = this[$scene].width;
      const height = this[$scene].height;

      const vector = position.clone().project(this[$scene].camera);

      return {
        x: (vector.x * 0.5 + 0.5) * width,
        y: (vector.y * -0.5 + 0.5) * height,
      };
    }

    protected _getMeasureFloorY(target: Object3D): number {
      const originalFloorY = (this as {originalFloorY?: number}).originalFloorY;
      if (originalFloorY !== undefined) {
        return originalFloorY;
      }
      return target.userData?.isSnappedGroup === true ? target.position.y : 0;
    }

    protected _refreshMeasurementVisibility() {
      this._updateViewOctant();
      if (this._lineGroups.length && this._lastCameraAngle.length) {
        this._updateMarkerVisibility();
      }
    }

    private _updateViewOctant() {
      const scene = this[$scene];
      scene.camera.getWorldPosition(this._cameraWorldPosition);

      if (this._measurementSpace) {
        this._lastCameraAngle = getViewOctantLabelInSpace(
          this._measurementSpace,
          this._cameraWorldPosition
        );
        return;
      }

      /* @ts-ignore */
      const {theta} = this.getCameraOrbit();
      const azimuthalOctant =
        (8 + Math.floor(((theta % TAU) + QUARTER_PI / 2) / (HALF_PI / 2))) % 8;
      this._lastCameraAngle = AZIMUTHAL_OCTANT_LABELS[azimuthalOctant];
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

      value = formatMetersWithUnit(width, unit, precision);
      this._measureWidthElement.textContent = value;
      this._measureWidthElement.style.display = 'block';
      this._measureWidthElement.setAttribute('aria-label', `Width: ${value}`);

      value = formatMetersWithUnit(height, unit, precision);
      this._measureHeightElement.textContent = value;
      this._measureHeightElement.style.display = 'block';
      this._measureHeightElement.setAttribute('aria-label', `Height: ${value}`);

      value = formatMetersWithUnit(depth, unit, precision);
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

    private _createGrid() {
      createGrid(this, {
        sceneSymbol: $scene,
        gridContainerSymbol: $gridContainer,
        needsRenderSymbol: $needsRender,
        clearGrid: () => this._clearGrid(),
      });
      syncGridShapesVisibilityImpl(this, {
        gridContainerSymbol: $gridContainer,
      });
    }

    private _getGridTargetObject(): Object3D | null {
      return getGridTargetObject(this, {
        sceneSymbol: $scene,
        gridContainerSymbol: $gridContainer,
        needsRenderSymbol: $needsRender,
        clearGrid: () => this._clearGrid(),
      });
    }

    private _disposeRenderableObject(object: Object3D) {
      object.traverse((child) => {
        if (child instanceof Mesh || child instanceof Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    private _createPlanarStrokeGeometry(
      path: Array<[number, number]>,
      thickness: number,
      y: number,
      offsetX: number,
      offsetZ: number,
      closed: boolean
    ): BufferGeometry | null {
      return createPlanarStrokeGeometryImpl(
        path,
        thickness,
        y,
        offsetX,
        offsetZ,
        closed
      );
    }

    addGridShapeLines(
      paths: Array<Array<[number, number]>> | Array<[number, number]>,
      options: {
        id?: string;
        color?: string | number;
        thickness?: number;
        coordinate?: [number, number];
      } = {}
    ): string {
      return addGridShapeLinesImpl(
        this,
        {
          sceneSymbol: $scene,
          gridContainerSymbol: $gridContainer,
          needsRenderSymbol: $needsRender,
          createGrid: () => this._createGrid(),
          getGridTargetObject: () => this._getGridTargetObject(),
        },
        paths,
        options
      );
    }

    removeGridShapeLines(id: string): boolean {
      return removeGridShapeLinesImpl(this, $needsRender, id);
    }

    private _clearGridShapeLines() {
      clearGridShapeLinesImpl(this);
    }

    private _setGridShapesVisible(visible: boolean) {
      setGridShapesVisibleImpl(
        this,
        {
          gridContainerSymbol: $gridContainer,
          needsRenderSymbol: $needsRender,
        },
        visible
      );
    }

    private _clearGrid() {
      clearGrid(this, {
        sceneSymbol: $scene,
        gridContainerSymbol: $gridContainer,
        needsRenderSymbol: $needsRender,
        clearGrid: () => this._clearGrid(),
      });
    }

    private _clearMeasurements(resetEverything = false) {
      clearMeasurementsImpl(this, { sceneSymbol: $scene }, resetEverything);
      this[$needsRender]();
    }

    private _getEdgeGroups(
      _corners: Vector3[],
      length: number,
      margin: number,
      _object: Object3D
    ) {
      // Corners are already in world space, just clone them
      const corners = _corners.map((corner) => corner.clone());

      // Extension lines should go from near the corner to past the dimension line
      // gap: small space between extension line and object corner
      // overshoot: how far past the dimension line the extension extends
      const gap = margin * 0.25;
      const overshoot = margin * 0;

      return [
        [
          /* Lower north side (negative Z) */
          /* Dimension line, left extension, right extension */
          [
            new Vector3(
              corners[0].x,
              corners[0].y,
              corners[0].z - length - margin
            ),
            new Vector3(
              corners[1].x,
              corners[1].y,
              corners[1].z - length - margin
            ),
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
          /* Lower east side (positive X) */
          /* Dimension line, left extension, right extension */
          [
            new Vector3(
              corners[1].x + length + margin,
              corners[1].y,
              corners[1].z
            ),
            new Vector3(
              corners[5].x + length + margin,
              corners[5].y,
              corners[5].z
            ),
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
        [
          /* Lower south side (positive Z) */
          /* Dimension line, left extension, right extension */
          [
            new Vector3(
              corners[4].x,
              corners[4].y,
              corners[4].z + length + margin
            ),
            new Vector3(
              corners[5].x,
              corners[5].y,
              corners[5].z + length + margin
            ),
          ],
          [
            new Vector3(corners[4].x, corners[4].y, corners[4].z + gap),
            new Vector3(
              corners[4].x,
              corners[4].y,
              corners[4].z + length + margin + overshoot
            ),
          ],
          [
            new Vector3(corners[5].x, corners[5].y, corners[5].z + gap),
            new Vector3(
              corners[5].x,
              corners[5].y,
              corners[5].z + length + margin + overshoot
            ),
          ],
        ],
        [
          /* Lower west side (negative X) */
          /* Dimension line, left extension, right extension */
          [
            new Vector3(
              corners[0].x - length - margin,
              corners[0].y,
              corners[0].z
            ),
            new Vector3(
              corners[4].x - length - margin,
              corners[4].y,
              corners[4].z
            ),
          ],
          [
            new Vector3(corners[0].x - gap, corners[0].y, corners[0].z),
            new Vector3(
              corners[0].x - length - margin - overshoot,
              corners[0].y,
              corners[0].z
            ),
          ],
          [
            new Vector3(corners[4].x - gap, corners[4].y, corners[4].z),
            new Vector3(
              corners[4].x - length - margin - overshoot,
              corners[4].y,
              corners[4].z
            ),
          ],
        ],
        // North Wall A (height on north-west edge)
        [
          [
            new Vector3(
              corners[0].x,
              corners[0].y,
              corners[0].z - length - margin
            ),
            new Vector3(
              corners[3].x,
              corners[3].y,
              corners[3].z - length - margin
            ),
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
            new Vector3(corners[3].x, corners[3].y, corners[3].z - gap),
            new Vector3(
              corners[3].x,
              corners[3].y,
              corners[3].z - length - margin - overshoot
            ),
          ],
        ],
        // North Wall B (height on north-east edge)
        [
          [
            new Vector3(
              corners[1].x,
              corners[1].y,
              corners[1].z - length - margin
            ),
            new Vector3(
              corners[2].x,
              corners[2].y,
              corners[2].z - length - margin
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
          [
            new Vector3(corners[2].x, corners[2].y, corners[2].z - gap),
            new Vector3(
              corners[2].x,
              corners[2].y,
              corners[2].z - length - margin - overshoot
            ),
          ],
        ],
        // East Wall A (height on north-east edge)
        [
          [
            new Vector3(
              corners[1].x + length + margin,
              corners[1].y,
              corners[1].z
            ),
            new Vector3(
              corners[2].x + length + margin,
              corners[2].y,
              corners[2].z
            ),
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
            new Vector3(corners[2].x + gap, corners[2].y, corners[2].z),
            new Vector3(
              corners[2].x + length + margin + overshoot,
              corners[2].y,
              corners[2].z
            ),
          ],
        ],
        // East Wall B (height on south-east edge)
        [
          [
            new Vector3(
              corners[5].x + length + margin,
              corners[5].y,
              corners[5].z
            ),
            new Vector3(
              corners[6].x + length + margin,
              corners[6].y,
              corners[6].z
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
          [
            new Vector3(corners[6].x + gap, corners[6].y, corners[6].z),
            new Vector3(
              corners[6].x + length + margin + overshoot,
              corners[6].y,
              corners[6].z
            ),
          ],
        ],
        // South Wall A (height on south-east edge)
        [
          [
            new Vector3(
              corners[5].x,
              corners[5].y,
              corners[5].z + length + margin
            ),
            new Vector3(
              corners[6].x,
              corners[6].y,
              corners[6].z + length + margin
            ),
          ],
          [
            new Vector3(corners[5].x, corners[5].y, corners[5].z + gap),
            new Vector3(
              corners[5].x,
              corners[5].y,
              corners[5].z + length + margin + overshoot
            ),
          ],
          [
            new Vector3(corners[6].x, corners[6].y, corners[6].z + gap),
            new Vector3(
              corners[6].x,
              corners[6].y,
              corners[6].z + length + margin + overshoot
            ),
          ],
        ],
        // South Wall B (height on south-west edge)
        [
          [
            new Vector3(
              corners[4].x,
              corners[4].y,
              corners[4].z + length + margin
            ),
            new Vector3(
              corners[7].x,
              corners[7].y,
              corners[7].z + length + margin
            ),
          ],
          [
            new Vector3(corners[4].x, corners[4].y, corners[4].z + gap),
            new Vector3(
              corners[4].x,
              corners[4].y,
              corners[4].z + length + margin + overshoot
            ),
          ],
          [
            new Vector3(corners[7].x, corners[7].y, corners[7].z + gap),
            new Vector3(
              corners[7].x,
              corners[7].y,
              corners[7].z + length + margin + overshoot
            ),
          ],
        ],
        // West Wall A (height on south-west edge)
        [
          [
            new Vector3(
              corners[4].x - length - margin,
              corners[4].y,
              corners[4].z
            ),
            new Vector3(
              corners[7].x - length - margin,
              corners[7].y,
              corners[7].z
            ),
          ],
          [
            new Vector3(corners[4].x - gap, corners[4].y, corners[4].z),
            new Vector3(
              corners[4].x - length - margin - overshoot,
              corners[4].y,
              corners[4].z
            ),
          ],
          [
            new Vector3(corners[7].x - gap, corners[7].y, corners[7].z),
            new Vector3(
              corners[7].x - length - margin - overshoot,
              corners[7].y,
              corners[7].z
            ),
          ],
        ],
        // West Wall B (height on north-west edge)
        [
          [
            new Vector3(
              corners[0].x - length - margin,
              corners[0].y,
              corners[0].z
            ),
            new Vector3(
              corners[3].x - length - margin,
              corners[3].y,
              corners[3].z
            ),
          ],
          [
            new Vector3(corners[0].x - gap, corners[0].y, corners[0].z),
            new Vector3(
              corners[0].x - length - margin - overshoot,
              corners[0].y,
              corners[0].z
            ),
          ],
          [
            new Vector3(corners[3].x - gap, corners[3].y, corners[3].z),
            new Vector3(
              corners[3].x - length - margin - overshoot,
              corners[3].y,
              corners[3].z
            ),
          ],
        ],
      ];
    }

    private _measureObject(object: Object3D, skipLastClickCheck?: boolean) {
      measureObjectImpl(this, { sceneSymbol: $scene }, object, skipLastClickCheck);
    }

    private _measureObjects(
      objects: Object3D[],
      skipLastClickCheck?: boolean
    ) {
      measureObjectsImpl(
        this,
        {sceneSymbol: $scene},
        objects,
        skipLastClickCheck
      );
    }

    private _getMeasureRoots(): Object3D[] {
      const getRoots = (this as any)._getSelectedRootObjects as
        | (() => Object3D[])
        | undefined;
      if (typeof getRoots === 'function') {
        return getRoots.call(this);
      }
      const selected = (this as any).getSelectedObjects?.() || [];
      if (selected.length === 0) return [];
      const selectedSet = new Set<Object3D>(selected);
      return selected.filter((node: Object3D) => {
        let parent: Object3D | null = node.parent;
        while (parent) {
          if (selectedSet.has(parent)) return false;
          parent = parent.parent;
        }
        return true;
      });
    }

    private _measureSelection(skipLastClickCheck?: boolean) {
      const roots = this._getMeasureRoots();
      if (roots.length === 0) {
        this._clearMeasurements(true);
        return;
      }
      this._measureObjects(roots, skipLastClickCheck);
    }

    private _measureScene() {
      this._measureObject(this[$scene], true);
    }

    private _isObjectInMeasuredSet(object: Object3D): boolean {
      if (this._measuredObjects.length === 0) return false;
      for (const measured of this._measuredObjects) {
        if (measured === object) return true;
        let node: Object3D | null = object;
        while (node) {
          if (node === measured) return true;
          node = node.parent;
        }
      }
      return false;
    }

    private _handleCameraChange() {
      const previousAngle = this._lastCameraAngle;
      this._updateViewOctant();

      if (previousAngle !== this._lastCameraAngle) {
        this._updateMarkerVisibility();
      } else {
        this._updateMarkerPosition();
      }
    }

    private _resolveTransformTargets(
      detail: TransformEventDetail
    ): Object3D[] {
      if (detail.targets?.length) {
        const uuids = new Set(detail.targets.map((t) => t.uuid));
        return this._measuredObjects.filter((obj) => uuids.has(obj.uuid));
      }
      if (detail.target.uuid === SELECTION_TRANSFORM_PIVOT_UUID) {
        return this._measuredObjects.length > 1 ? [...this._measuredObjects] : [];
      }
      const match = this._measuredObjects.find(
        (obj) => obj.uuid === detail.target.uuid
      );
      return match ? [match] : [];
    }

    private _doesTransformAffectMeasuredRoots(
      detail: TransformEventDetail
    ): boolean {
      if (this._measuredObjects.length === 0) {
        return false;
      }

      if (detail.target.uuid === SELECTION_TRANSFORM_PIVOT_UUID) {
        if (!detail.targets?.length) {
          // transformend clears the session before building detail.targets
          return this._measuredObjects.length > 1;
        }
        const uuids = new Set(detail.targets.map((t) => t.uuid));
        return this._measuredObjects.some((obj) => uuids.has(obj.uuid));
      }

      return this._resolveTransformTargets(detail).length > 0;
    }

    private _onTransform = (event: Event) => {
      if (!this.measure || this._measuredObjects.length === 0) {
        return;
      }

      const detail = (event as CustomEvent<TransformEventDetail>).detail;
      if (!this._doesTransformAffectMeasuredRoots(detail)) {
        return;
      }

      // Multi-select: rebuild lines each transform (same approach as object-drag).
      if (this._measuredObjects.length > 1) {
        this._measureSelection(true);
        return;
      }

      const targets = this._resolveTransformTargets(detail);
      if (targets.length === 0) {
        return;
      }

      if (event.type === 'transformend') {
        this._measureSelection(true);
        return;
      }

      syncMeasurementTransformImpl(this, targets, detail);
    };

    private _onSelectionChangeForMeasure = (event: Event) => {
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

      this._measureSelection(true);
    };

    private _onObjectDrag = (event: Event) => {
      if (
        !this.measure ||
        (this._measuredObjects.length === 0 && !this._measuredSelectionKey)
      ) {
        return;
      }

      const customEvent = event as CustomEvent<{
        object: Object3D;
        position: Vector3;
      }>;
      const {object} = customEvent.detail;

      if (this._isObjectInMeasuredSet(object)) {
        this._measureSelection(true);
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
      this._touchExtractedMembers();

      this._setExtensionLineLength();

      this.handleNewAttributes();
      this._createGrid();
      this._setGridShapesVisible(this.gridShapes);
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
          this._measureSelection(true);
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

        // Handle grid-related property changes
        if (
          changedProperties.has('showGrid') ||
          changedProperties.has('gridSize') ||
          changedProperties.has('gridMajor') ||
          changedProperties.has('gridMinor') ||
          (changedProperties.has('measurementUnit') && this.showGrid)
        ) {
          this._createGrid();
        }

        if (changedProperties.has('gridShapes')) {
          this._setGridShapesVisible(this.gridShapes);
        }
      }
    }

    connectedCallback() {
      super.connectedCallback();

      this.addEventListener('camera-change', this._handleCameraChange);
      this.addEventListener('load', this._handleLoad);
      this.addEventListener('progress', this._handleProgress);

      // Store bound handler for cleanup
      this._boundSelectionChangeHandler = (event: Event) => {
        this._onSelectionChangeForMeasure(event);
      };
      this.addEventListener(
        'selection-change',
        this._boundSelectionChangeHandler
      );

      this.addEventListener('object-drag', this._onObjectDrag as EventListener);
      this.addEventListener('transform', this._onTransform as EventListener);
      this.addEventListener('transformend', this._onTransform as EventListener);

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

      if (this._boundSelectionChangeHandler) {
        this.removeEventListener(
          'selection-change',
          this._boundSelectionChangeHandler
        );
      }

      this.removeEventListener(
        'object-drag',
        this._onObjectDrag as EventListener
      );
      this.removeEventListener('transform', this._onTransform as EventListener);
      this.removeEventListener(
        'transformend',
        this._onTransform as EventListener
      );

      this._clearGrid();
      this._clearGridShapeLines();
      this._measureWidthElement = null;
      this._measureHeightElement = null;
      this._measureDepthElement = null;
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (this.measure && this._lineGroups.length) {
        this._updateMarkerPosition();
      }
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
