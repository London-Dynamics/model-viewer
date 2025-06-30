// @ts-nocheck

declare global {
  interface Window {
    deDraco: any;
  }
}

import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { LDExporter } from './ld-exporter.js';

import ModelViewerElementBase, {
  $scene,
  $needsRender,
} from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import { createSafeObjectUrlFromArrayBuffer } from '../utilities/create_object_url.js';

class Cursor extends Object3D {
  private scene: any = null;
  private targetObject: Object3D | null = null;

  constructor(scene: any, targetObject: Object3D) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;

    const RADIUS = 0.1; // Radius of the circle

    /* this should be a flat circle, 0.2m in diameter, slightly darker than white, 50% transparent, placed at the origin */
    const geometry = new CircleGeometry(RADIUS, 32);
    const material = new MeshBasicMaterial({
      color: 0xf5f5f5, // Slightly darker than white (WhiteSmoke)
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Rotate to face up
    mesh.position.set(0, 0.01, 0); // Slightly above ground level
    this.add(mesh);

    /* Add contours around the circle - primary and high-contrast for dark backgrounds */
    const contourGeometry = new BufferGeometry();
    const contourPoints = [];
    const segments = 64; // Higher number for smoother circle

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      contourPoints.push(
        new Vector3(Math.cos(angle) * RADIUS, 0, Math.sin(angle) * RADIUS)
      );
    }

    contourGeometry.setFromPoints(contourPoints);

    // Primary contour - slightly darker than the circle
    const contourMaterial = new LineBasicMaterial({
      color: 0xd3d3d3, // Light gray - slightly darker than the circle
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });

    const contourLine = new LineLoop(contourGeometry, contourMaterial);
    contourLine.position.set(0, 0.011, 0); // Slightly above the circle
    this.add(contourLine);

    // High-contrast contour for dark backgrounds
    const darkContourMaterial = new LineBasicMaterial({
      color: 0x333333, // Dark gray for contrast against dark backgrounds
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    const darkContourLine = new LineLoop(
      contourGeometry.clone(),
      darkContourMaterial
    );
    darkContourLine.position.set(0, 0.012, 0); // Slightly higher than primary contour
    this.add(darkContourLine);

    // Add to target object and position at placement level
    targetObject.add(this);
    this.positionAtPlacementLevel();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
  }

  // Method to position the cursor at the placement level of the scene
  positionAtPlacementLevel() {
    if (this.scene && this.scene.boundingBox) {
      // Position at the minimum Y of the bounding box (placement level)
      this.position.y = this.scene.boundingBox.min.y;
    }
  }

  // Update cursor position based on mouse coordinates
  updatePosition(
    clientX: number,
    clientY: number,
    element: any,
    needsRender: () => void
  ) {
    if (!this.scene) return;

    // Convert raw client coordinates to element-relative coordinates
    const rect = element.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Convert to normalized device coordinates (-1 to 1)
    const x = (mouseX / rect.width) * 2 - 1;
    const y = -(mouseY / rect.height) * 2 + 1;

    // Create a raycaster from the camera
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(x, y), this.scene.camera);

    // Create a virtual placement plane at the scene's placement level
    const placementY = this.scene.boundingBox
      ? this.scene.boundingBox.min.y
      : 0;

    // Calculate intersection with the placement plane (Y = placementY)
    const ray = raycaster.ray;
    const directionY = ray.direction.y;

    if (Math.abs(directionY) > 0.0001) {
      // Avoid division by zero
      const t = (placementY - ray.origin.y) / directionY;

      if (t > 0) {
        // Ray hits the plane in front of camera
        const intersectionPoint = ray.origin
          .clone()
          .add(ray.direction.clone().multiplyScalar(t));

        // Position the cursor at the intersection point
        this.position.copy(intersectionPoint);
        this.position.y = placementY + 0.01; // Slightly above the placement surface

        this.setVisible(true);
      } else {
        this.setVisible(false);
      }
    } else {
      this.setVisible(false);
    }

    needsRender();
  }

  resetPosition() {
    if (this.targetObject) {
      this.positionAtFloor();
    }
  }
}

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
              this.animateGravityFall(
                gltf.scene,
                dropStartY,
                finalPosition.y,
                mass
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

    private animateGravityFall(
      model: Object3D,
      startY: number,
      targetY: number,
      mass: number = 1.0
    ) {
      const gravity = 10; // m/s²
      const timeScale = 1000; // Convert to milliseconds

      // Calculate fall time based on physics: t = sqrt(2h/g)
      const fallDistance = startY - targetY;
      const fallTime = Math.sqrt((2 * fallDistance) / gravity) * timeScale;

      // Add some variation based on mass (heavier objects fall slightly faster due to less air resistance)
      const massModifier = Math.min(1.0 + (mass - 1.0) * 0.1, 2.0);
      const adjustedFallTime = fallTime / massModifier;

      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / adjustedFallTime, 1.0);

        // Use quadratic easing for realistic gravity acceleration
        const easedProgress = progress * progress;

        // Calculate current position
        const currentY = startY - fallDistance * easedProgress;
        model.position.y = Math.max(currentY, targetY);

        // Trigger render
        this[$needsRender]();

        // Continue animation if not finished
        if (progress < 1.0) {
          requestAnimationFrame(animate);
        } else {
          // Ensure final position is exact
          model.position.y = targetY;
          this[$needsRender]();
        }
      };

      requestAnimationFrame(animate);
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
