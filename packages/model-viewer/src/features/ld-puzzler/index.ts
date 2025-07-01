// @ts-nocheck

declare global {
  interface Window {
    deDraco: any;
  }
}

import { Box3, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { LDExporter } from '../ld-exporter.js';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../../model-viewer-base.js';

import { Constructor } from '../../utilities.js';
import { createSafeObjectUrlFromArrayBuffer } from '../../utilities/create_object_url.js';
import { animateGravityFallSmooth } from '../../utilities/animation.js';
import { Cursor } from './cursor.js';

const DROP_HEIGHT = 0.5; // Height to drop models from when placed
const LIFT_HEIGHT = 0.1; // Height to lift models to when selected

export type PlacementOptions = {
  name?: string;
  position?: { x: number; y: number; z: number };
  mass?: number; // Mass in kg, affects fall speed
  floorOffset?: number; // Additional Y offset from calculated floor position (e.g., 0.5 for center-positioned cubes)
};

export declare interface LDPuzzlerInterface {
  placementCursor: boolean;
  placementCursorSize: number;
  setSrcFromBuffer(buffer: ArrayBuffer): void;
  placeGLB(src: string, options?: PlacementOptions): Promise<void>;
  getPlacementCursorPosition(): { x: number; y: number; z: number } | null;
}

export const LDPuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'placement-cursor' })
    placementCursor: boolean = false;

    @property({ type: Number, attribute: 'placement-cursor-size' })
    placementCursorSize: number = 0.5; // Default diameter of 0.5m

    private cursor: Cursor | undefined;
    private addedGLBs: Set<Object3D> = new Set(); // Track all added GLBs
    private _modelLoaded = false;
    private originalFloorY: number | undefined; // Store the original floor level

    private updateShadowsWithGLBs() {
      // Create a comprehensive bounding box that includes all added GLBs
      if (this[$scene].boundingBox && this.addedGLBs.size > 0) {
        // Store the original floor level if not already stored
        if (this.originalFloorY === undefined) {
          this.originalFloorY = this[$scene].boundingBox.min.y;
        }

        // Start with the original scene bounding box
        const originalBounds = this[$scene].boundingBox.clone();

        // Expand to include all added GLBs, but preserve the original floor level
        this.addedGLBs.forEach((glb) => {
          originalBounds.expandByObject(glb);
        });

        // Preserve the original floor level by ensuring it never goes below the original
        originalBounds.min.y = this.originalFloorY;

        // Update the scene's bounding box and size
        this[$scene].boundingBox.copy(originalBounds);
        this[$scene].boundingBox.getSize(this[$scene].size);

        // Force shadow update
        this[$scene].updateShadow();
      }
    }

    async setSrcFromBuffer(buffer: ArrayBuffer) {
      try {
        const safeObjectUrl = createSafeObjectUrlFromArrayBuffer(buffer);

        this.setAttribute('src', safeObjectUrl.url);
      } catch (e) {
        console.error(e);
      }
    }

    private handlePlacementCursorAttribute() {
      if (this.placementCursor) {
        this.enablePlacementCursor();
      } else {
        this.disablePlacementCursor();
      }
    }

    private handlePlacementCursorSizeAttribute() {
      if (this.cursor) {
        // Convert diameter to radius
        const radius = this.placementCursorSize / 2;
        this.cursor.setRadius(radius);
        this[$needsRender]();
      }
    }

    private _handleProgress(event: Event) {
      const progress = (event as any).detail.totalProgress;
      const reason = (event as any).detail.reason;

      if (this._modelLoaded && reason === 'model-load' && progress < 1) {
        this._modelLoaded = false;
      }
    }

    private _handleLoad() {
      this._modelLoaded = true;
      this.handlePlacementCursorAttribute();
      this.handlePlacementCursorSizeAttribute();
    }

    private enablePlacementCursor() {
      if (!this.cursor) {
        const targetObject = this.findTargetObject();
        if (targetObject) {
          // Create cursor with scene and target references
          // Convert diameter to radius
          const radius = this.placementCursorSize / 2;
          this.cursor = new Cursor(this[$scene], targetObject, radius);
          // Setup mouse tracking configuration
          this.cursor.setupMouseTracking(this, () => this[$needsRender]());
        }
      }

      if (this.cursor) {
        this.cursor.setVisible(true); // This will automatically enable mouse tracking
        this[$needsRender]();
      }
    }

    private disablePlacementCursor() {
      if (this.cursor) {
        this.cursor.setVisible(false); // This will automatically disable mouse tracking
        this[$needsRender]();
      }
    }

    getPlacementCursorPosition(): { x: number; y: number; z: number } | null {
      if (this.cursor && this.cursor.visible) {
        return {
          x: this.cursor.position.x,
          y: this.cursor.position.y,
          z: this.cursor.position.z,
        };
      }
      return null;
    }

    private findTargetObject() {
      let targetObject: Object3D | undefined;

      try {
        this[$scene].traverse((child) => {
          if (child.name === 'Target') {
            targetObject = child;
            throw new Error('found target object'); // Stop traversal when found
          }
        });
      } catch (e) {
        if ((e as Error).message !== 'found target object') throw e;
      }

      return targetObject;
    }

    private positionModelAtFloor(model: Object3D, floorOffset: number = 0) {
      if (!this[$scene] || !this[$scene].boundingBox) return;

      // Store the original floor level if not already stored
      if (this.originalFloorY === undefined) {
        this.originalFloorY = this[$scene].boundingBox.min.y;
      }

      // Calculate the model's bounding box
      const modelBoundingBox = new Box3().setFromObject(model);

      // Use the original floor level, not the current scene bounding box
      const sceneFloorY = this.originalFloorY;

      // Calculate how much to move the model so its bottom aligns with the original floor
      const modelBottomY = modelBoundingBox.min.y;
      const offsetY = sceneFloorY - modelBottomY + floorOffset;

      // Apply the position adjustment
      model.position.y += offsetY;
    }

    async placeGLB(src: string, options: PlacementOptions = {}): Promise<void> {
      const loader = new GLTFLoader();

      const targetObject = this.findTargetObject();

      return new Promise((resolve, reject) => {
        loader.load(
          src,
          (gltf) => {
            gltf.scene.name =
              'part__' +
              (options.name ||
                `model-${Math.random().toString(36).substring(2, 9)}`);
            if (targetObject) {
              let finalPosition: { x: number; y: number; z: number };

              // Determine the final floor position
              if (options.position) {
                // Use provided position but ensure Y is at floor level for gravity calculation
                // Store the original floor level if not already stored
                if (this.originalFloorY === undefined) {
                  this.originalFloorY = this[$scene].boundingBox
                    ? this[$scene].boundingBox.min.y
                    : 0;
                }

                const floorY = this.originalFloorY;
                const floorOffset = options.floorOffset || 0;
                finalPosition = {
                  x: options.position.x,
                  y: floorY + floorOffset,
                  z: options.position.z,
                };
              } else {
                // Calculate floor position automatically with optional offset
                this.positionModelAtFloor(gltf.scene, options.floorOffset || 0);
                finalPosition = {
                  x: gltf.scene.position.x,
                  y: gltf.scene.position.y,
                  z: gltf.scene.position.z,
                };
              }

              // Set initial position above the final position
              const dropStartY = finalPosition.y + DROP_HEIGHT;
              gltf.scene.position.set(
                finalPosition.x,
                dropStartY,
                finalPosition.z
              );

              // Add model to scene first
              targetObject.add(gltf.scene);

              // Track this GLB for shadow calculations
              this.addedGLBs.add(gltf.scene);

              // Update shadows to include all GLBs
              this.updateShadowsWithGLBs();
              this[$needsRender]();

              // Start gravity animation
              const mass = options.mass || 1.0; // Default mass of 1kg
              animateGravityFallSmooth(
                gltf.scene,
                dropStartY,
                finalPosition.y,
                mass,
                () => {
                  this.updateShadowsWithGLBs();
                  this[$needsRender]();
                },
                () => {
                  // Final shadow update when animation completes
                  this.updateShadowsWithGLBs();
                  this[$needsRender]();
                }
              );

              resolve();
            } else {
              reject();
            }
          },
          (xhr) => {
            console.log(
              `Loading model: ${Math.round((xhr.loaded / xhr.total) * 100)}%`
            );
          },
          (error) => {
            console.error('Error loading GLB:', error);
            reject(error);
          }
        );
      });
    }

    /* Remove draco compression from a glb
     *
     * @param {ArrayBuffer} inputBuffer GLB with draco
     * @return {Promise<ArrayBuffer>} GLB without draco
     */
    deDraco(inputBuffer: ArrayBuffer) {
      return new Promise((res) => {
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath(
          'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/'
        );
        loader.setDRACOLoader(dracoLoader);

        loader.parse(
          inputBuffer,
          '',
          (model) => {
            if (model.scene) {
              model.scene.traverse((node) => {
                if (node.userData['name']) {
                  node.name = node.userData['name'];
                }
              });
              const exporter = new LDExporter();
              exporter.parse(
                model.scene.children,
                (arrayBuffer) => {
                  res(arrayBuffer);
                },
                function (err) {
                  console.error(err);
                },
                { binary: true }
              );
            } else {
              res(inputBuffer);
            }
          },
          (error) => {
            console.error(error);
          }
        );
      });
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (this._modelLoaded && changedProperties.has('placementCursor')) {
        this.handlePlacementCursorAttribute();
      }

      if (this._modelLoaded && changedProperties.has('placementCursorSize')) {
        this.handlePlacementCursorSizeAttribute();
      }
    }

    connectedCallback() {
      super.connectedCallback();

      this.addEventListener('load', this._handleLoad);
      this.addEventListener('progress', this._handleProgress);

      if (typeof window !== 'undefined') {
        window.deDraco = this.deDraco;
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this.removeEventListener('load', this._handleLoad);
      this.removeEventListener('progress', this._handleProgress);

      if (this.cursor) {
        this.cursor.cleanup();
      }
    }
  }

  return LDPuzzlerModelViewerElement;
};
