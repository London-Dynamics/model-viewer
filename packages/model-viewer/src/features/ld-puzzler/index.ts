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

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../../model-viewer-base.js';

import { Constructor } from '../../utilities.js';
import { createSafeObjectUrlFromArrayBuffer } from '../../utilities/create_object_url.js';
import { animateGravityFall } from '../../utilities/animation.js';
import { Cursor } from './cursor.js';

// Global variable for drop height (in meters)
const DROP_HEIGHT = 0.5;

export type PlacementOptions = {
  name?: string;
  position?: { x: number; y: number; z: number };
  mass?: number; // Mass in kg, affects fall speed
};

export declare interface LDPuzzlerInterface {
  setSrcFromBuffer(buffer: ArrayBuffer): void;
  showPlacementCursor(): void;
  hidePlacementCursor(): void;
  placeGLB(src: string, options?: PlacementOptions): Promise<void>;
  getPlacementCursorPosition(): { x: number; y: number; z: number } | null;
}

export const LDPuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    private cursor: Cursor | undefined;

    async setSrcFromBuffer(buffer: ArrayBuffer) {
      try {
        const safeObjectUrl = createSafeObjectUrlFromArrayBuffer(buffer);

        this.setAttribute('src', safeObjectUrl.url);
      } catch (e) {
        console.error(e);
      }
    }

    showPlacementCursor() {
      if (!this.cursor) {
        const targetObject = this.findTargetObject();
        if (targetObject) {
          // Create cursor with scene and target references
          this.cursor = new Cursor(this[$scene], targetObject);
        }
      }
      if (this.cursor) {
        this.cursor.setVisible(true);
        this[$needsRender]();
      }
    }

    hidePlacementCursor() {
      if (this.cursor) {
        this.cursor.setVisible(false);
        this[$needsRender]();
      }
    }

    updatePlacementCursorPosition(mouseX: number, mouseY: number) {
      if (this.cursor) {
        this.cursor.updatePosition(mouseX, mouseY, this, () =>
          this[$needsRender]()
        );
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

    private positionModelAtFloor(model: Object3D) {
      if (!this[$scene] || !this[$scene].boundingBox) return;

      // Calculate the model's bounding box
      const modelBoundingBox = new Box3().setFromObject(model);

      // Get the scene's floor level
      const sceneFloorY = this[$scene].boundingBox.min.y;

      // Calculate how much to move the model so its bottom aligns with the scene floor
      const modelBottomY = modelBoundingBox.min.y;
      const offsetY = sceneFloorY - modelBottomY;

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
                const floorY = this[$scene].boundingBox
                  ? this[$scene].boundingBox.min.y
                  : 0;
                finalPosition = {
                  x: options.position.x,
                  y: floorY,
                  z: options.position.z,
                };
              } else {
                // Calculate floor position automatically
                this.positionModelAtFloor(gltf.scene);
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
              this[$scene].updateBoundingBox();
              this[$scene].updateShadow();
              this[$needsRender]();

              // Start gravity animation
              const mass = options.mass || 1.0; // Default mass of 1kg
              animateGravityFall(
                gltf.scene,
                dropStartY,
                finalPosition.y,
                mass,
                () => this[$needsRender]()
              );

              console.log('scene', this[$scene]);
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

    connectedCallback() {
      super.connectedCallback();

      if (typeof window !== 'undefined') {
        window.deDraco = this.deDraco;
      }
    }
  }

  return LDPuzzlerModelViewerElement;
};
