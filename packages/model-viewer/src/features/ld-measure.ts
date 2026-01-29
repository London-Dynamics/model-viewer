import { property } from 'lit/decorators.js';
import {
  Box3,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Object3D,
  Object3DEventMap,
  Vector3,
  NormalBlending,
} from 'three';

import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
  $needsRender,
  $tick,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import { $controls } from './controls.js';
import { SelectionChangeDetail, SelectionScope } from './ld-selection/index.js';
import {
  AZIMUTHAL_OCTANT_LABELS,
  formatMetersWithUnit,
  convertToMeters,
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
const $gridContainer = Symbol('gridContainer');

export const LDMeasureMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDMeasureInterface> & T => {
  // LDPuzzlerMixin (which this wraps) already applies LDSelectionMixin,
  // so we inherit selection functionality without reapplying it
  class LDMeasureModelViewerElement extends ModelViewerElement {
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
    private _lastClickedObject: Object3D | null = null;
    private _lastCameraAngle: string = '';
    private _extensionLineLength: number = 0.2;

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
      const scene = this[$scene];

      // Remove existing grid if any
      this._clearGrid();

      if (!this.showGrid) {
        return;
      }

      // Don't draw grid if both spacings are 0
      if (this.gridMajor <= 0 && this.gridMinor <= 0) {
        return;
      }

      // Find the Target object to add the grid
      let targetObject: Object3D | undefined;
      scene.traverse((child) => {
        if (child.name === 'Target') {
          targetObject = child;
        }
      });

      if (!targetObject) {
        console.warn('Target object not found for grid');
        return;
      }

      const target = targetObject as Object3D;

      // Create grid container
      const gridContainer = new Object3D();
      gridContainer.name = 'ld-grid';
      this[$gridContainer] = gridContainer;

      // Convert grid spacing from display units to meters
      const minorSpacing = convertToMeters(
        this.gridMinor,
        this.measurementUnit
      );
      const majorSpacing = convertToMeters(
        this.gridMajor,
        this.measurementUnit
      );

      // Get the floor Y position (bottom of bounding box)
      const floorY = scene.boundingBox.min.y;
      const gridY = floorY + 0.001;

      // Calculate grid bounds using gridSize attribute (centered at origin)
      const halfSize = this.gridSize / 2;

      // Calculate line widths in world units based on screen pixels
      // Approximate: 1 pixel ≈ 0.001 meters at typical viewing distances
      const minorLineWidth = 0.01;
      const majorLineWidth = 0.02;

      // Use thin rectangular meshes instead of lines for precise width control
      const minorMaterial = new MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.2,
        depthTest: true,
        depthWrite: false,
      });

      const majorMaterial = new MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.5,
        depthTest: true,
        depthWrite: false,
      });

      const startX = -halfSize;
      const endX = halfSize;
      const startZ = -halfSize;
      const endZ = halfSize;
      const gridLength = this.gridSize;

      // Create vertical lines (parallel to Z axis) using thin rectangles
      if (this.gridMinor > 0) {
        for (
          let x = Math.floor(startX / minorSpacing) * minorSpacing;
          x <= endX;
          x += minorSpacing
        ) {
          const isMajor =
            this.gridMajor > 0 && Math.abs(x % majorSpacing) < 0.001;

          const material = isMajor ? majorMaterial : minorMaterial;
          const lineWidth = isMajor ? majorLineWidth : minorLineWidth;

          // Create a thin horizontal rectangle (width x length, rotated to lie flat)
          const geometry = new PlaneGeometry(lineWidth, gridLength);
          const mesh = new Mesh(geometry, material);

          // Position at x, gridY, center of Z range
          mesh.position.set(x, gridY, 0);

          // Rotate to lie flat on XZ plane (facing up)
          mesh.rotation.x = -Math.PI / 2;

          mesh.userData.noHit = true;
          mesh.frustumCulled = false;
          gridContainer.add(mesh);
        }
      } else if (this.gridMajor > 0) {
        for (
          let x = Math.floor(startX / majorSpacing) * majorSpacing;
          x <= endX;
          x += majorSpacing
        ) {
          const geometry = new PlaneGeometry(majorLineWidth, gridLength);
          const mesh = new Mesh(geometry, majorMaterial);
          mesh.position.set(x, gridY, 0);
          mesh.rotation.x = -Math.PI / 2;
          mesh.userData.noHit = true;
          mesh.frustumCulled = false;
          gridContainer.add(mesh);
        }
      }

      // Create horizontal lines (parallel to X axis) using thin rectangles
      if (this.gridMinor > 0) {
        for (
          let z = Math.floor(startZ / minorSpacing) * minorSpacing;
          z <= endZ;
          z += minorSpacing
        ) {
          const isMajor =
            this.gridMajor > 0 && Math.abs(z % majorSpacing) < 0.001;

          const material = isMajor ? majorMaterial : minorMaterial;
          const lineWidth = isMajor ? majorLineWidth : minorLineWidth;

          // Create a thin horizontal rectangle (length x width, rotated to lie flat)
          const geometry = new PlaneGeometry(gridLength, lineWidth);
          const mesh = new Mesh(geometry, material);

          // Position at center of X range, gridY, z
          mesh.position.set(0, gridY, z);

          // Rotate to lie flat on XZ plane (facing up)
          mesh.rotation.x = -Math.PI / 2;

          mesh.userData.noHit = true;
          mesh.frustumCulled = false;
          gridContainer.add(mesh);
        }
      } else if (this.gridMajor > 0) {
        for (
          let z = Math.floor(startZ / majorSpacing) * majorSpacing;
          z <= endZ;
          z += majorSpacing
        ) {
          const geometry = new PlaneGeometry(gridLength, majorLineWidth);
          const mesh = new Mesh(geometry, majorMaterial);
          mesh.position.set(0, gridY, z);
          mesh.rotation.x = -Math.PI / 2;
          mesh.userData.noHit = true;
          mesh.frustumCulled = false;
          gridContainer.add(mesh);
        }
      }

      target.add(gridContainer);
      this[$needsRender]();
    }

    private _clearGrid() {
      if (!this[$gridContainer]) {
        return;
      }

      // Remove from parent
      if (this[$gridContainer].parent) {
        this[$gridContainer].parent.remove(this[$gridContainer]);
      }

      // Dispose geometries and materials
      this[$gridContainer].traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      this[$gridContainer] = null;
      this[$needsRender]();
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

      // Corners stay in world space - the bounding box is world-axis-aligned
      const corners = boundingBoxCorners;

      // Create a material for the lines
      const lineMaterial = new LineBasicMaterial({ color: 0x000000 });
      lineMaterial.transparent = true;

      lineMaterial.opacity = 1;
      lineMaterial.depthTest = false; // Disable depth test to make the lines render on top of the model
      lineMaterial.blending = NormalBlending;

      // Calculate extension line length based on the object's bounding box
      // Use a proportion of the smallest dimension
      const objectSize = boundingBox.getSize(new Vector3());
      const minDimension = Math.min(objectSize.x, objectSize.y, objectSize.z);
      const length =
        minDimension > 0 ? minDimension / 10 : this._extensionLineLength;
      const margin = length / 2; // Margin between dimensions and model.

      const edgeGroups = this._getEdgeGroups(corners, length, margin, object);

      // Create a parent object to hold the lines
      const lineParent = new Object3D();
      lineParent.name = 'ld-measurements';

      // Determine the parent for the lines and get its inverse matrix
      let linesParentObject: Object3D | null = null;
      const inverseMatrix = new Matrix4();
      let needsCoordinateTransform = false;

      if (object === scene) {
        // Find the Target object and add lines there
        // scene.boundingBox is already in Target's local space, so no transform needed
        scene.traverse((child) => {
          if (child.name === 'Target') {
            linesParentObject = child;
          }
        });
        needsCoordinateTransform = false;
      } else {
        // Add to the selected object itself
        // boundingBox.expandByObject returns world coordinates, so we need to transform
        linesParentObject = object;
        needsCoordinateTransform = true;
      }

      if (linesParentObject) {
        if (needsCoordinateTransform) {
          // Get the inverse of the parent's world matrix to convert world coords to local
          linesParentObject.updateWorldMatrix(true, false);
          inverseMatrix.copy(linesParentObject.matrixWorld).invert();
        }
        linesParentObject.add(lineParent);
      }

      // Helper function to convert world point to parent's local space
      const toLocalSpace = (point: Vector3): Vector3 => {
        if (needsCoordinateTransform) {
          return point.clone().applyMatrix4(inverseMatrix);
        }
        return point.clone();
      };

      edgeGroups.forEach((group) => {
        const lines: Line[] = [];

        group.forEach((edge) => {
          // Convert edge points from world space to parent's local space
          const localEdge = edge.map((point) => toLocalSpace(point));

          const geometry = new BufferGeometry().setFromPoints(localEdge);
          const line = new Line(geometry, lineMaterial);

          line.userData.noHit = true; // unique model-viewer attribute to prevent hit testing

          line.renderOrder = 9999; // Render on top of the model

          line.visible = false; // Hide the lines initially

          // Prevent frustum culling which might hide the lines
          line.frustumCulled = false;

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

      // Measure the first selected object
      if (selectedObjects.length > 0) {
        this._measureObject(selectedObjects[0], true);
      }
    };

    private _onObjectDrag = (event: Event) => {
      // Update measurements when the object being measured is dragged
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
        // Re-measure the object to update line positions
        // Since lines are attached to scene, we need to recreate them at new positions
        this._measureObject(measuredObject, true);
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
      this._createGrid();
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
          // If nothing is selected, wait for user to click (selection will trigger _onSelectionChangeForMeasure)
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

      this._clearGrid();
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
