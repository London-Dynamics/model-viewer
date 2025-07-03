// @ts-nocheck

declare global {
  interface Window {
    deDraco: any;
  }
}

import {
  Box3,
  Object3D,
  Vector3,
  Raycaster,
  Vector2,
  Plane,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  TextureLoader,
  RepeatWrapping,
  SphereGeometry,
  Group,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { LDExporter } from '../ld-exporter.js';
import { property } from 'lit/decorators.js';

import ModelViewerElementBase, {
  $scene,
  $renderer,
  $needsRender,
  $canvas,
} from '../../model-viewer-base.js';
import { $controls } from '../controls.js';

import { Constructor } from '../../utilities.js';
import { createSafeObjectUrlFromArrayBuffer } from '../../utilities/create_object_url.js';
import { animateGravityFallSmooth } from '../../utilities/animation.js';
import { Cursor } from './cursor.js';

const DROP_HEIGHT = 0.5; // Height to drop models from when placed
const SNAP_POINT_DIAMETER = 0.1; // Diameter of snap point spheres in meters

export type PlacementOptions = {
  name?: string;
  position?: { x: number; y: number; z: number };
  mass?: number; // Mass in kg, affects fall speed
  floorOffset?: number; // Additional Y offset from calculated floor position (e.g., 0.5 for center-positioned cubes)
  snapPoints?: { x: number; y: number; z: number }[]; // Optional snap points relative to object center
};

export declare interface LDPuzzlerInterface {
  placementCursor: boolean;
  placementCursorSize: number;
  setSrcFromBuffer(buffer: ArrayBuffer): void;
  placeGLB(src: string, options?: PlacementOptions): Promise<void>;
  getPlacementCursorPosition(): { x: number; y: number; z: number } | null;
}

/**
 * LDPuzzlerMixin adds interactive object placement and selection functionality to model-viewer.
 *
 * Features:
 * - Object placement with gravity animation
 * - Click selection with visual outlines (requires model-viewer-effects)
 * - Drag and drop for selected objects
 * - Placement cursor for guided positioning
 * - Name-based object grouping for future multi-selection support
 * - Snap points for object positioning and alignment
 *
 * Object Naming Convention for Grouping:
 * The 'name' property in PlacementOptions supports special syntax for automatic grouping:
 * - "chair_01" -> groupId: "chair", instanceId: "01" (underscore separates group from instance)
 * - "table-wood_large" -> groupId: "table-wood", instanceId: "large" (hyphens allowed in groupId)
 * - "car#red_001" -> groupId: "car", tags: ["red"], instanceId: "001" (# adds tags)
 * - "duck" -> groupId: "duck", no instanceId (simple name becomes the groupId)
 *
 * Snap Points:
 * - If no snapPoints are provided in PlacementOptions, default snap points are generated
 * - Default snap points are placed at the middle of each side of the object's bounding box (front, back, left, right)
 * - When any object is selected, all snap points for all objects are displayed as white spheres
 * - Snap point spheres have a diameter of 0.1m and are semi-transparent
 *
 * Future multi-selection will be able to select all objects by groupId or tags.
 *
 * Outline Functionality Requirements:
 * To enable visual outlines for selected objects, you must include the model-viewer-effects
 * custom elements in your HTML:
 *
 * ```html
 * <script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer-effects/dist/model-viewer-effects.min.js"></script>
 *
 * <model-viewer>
 *   <effect-composer>
 *     <outline-effect color="white" strength="3" smoothing="1" blend-mode="skip"></outline-effect>
 *   </effect-composer>
 * </model-viewer>
 * ```
 *
 * The ld-puzzler component will automatically:
 * - Set blend-mode="default" when objects are selected (enables outline rendering)
 * - Set blend-mode="skip" when no objects are selected (disables outline rendering)
 *
 * If outline-effect is not present, selection will still work but without visual feedback.
 */

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

    // Selection and dragging properties
    private selectedObjects: Object3D[] = [];
    private selectedGroups: Set<Object3D> = new Set(); // Track selected groups for multi-selection
    private isDragging: boolean = false;
    private dragStartPosition: Vector3 = new Vector3();
    private dragStartMousePosition: Vector2 = new Vector2();
    private dragOffset: Vector3 = new Vector3(); // Offset between object center and click point
    private currentMousePosition: Vector2 = new Vector2();
    private floorPlane: Plane = new Plane(new Vector3(0, 1, 0), 0);
    private raycaster: Raycaster = new Raycaster();

    // Mouse tracking
    private lastClickTime: number = 0;
    private lastClickPosition: Vector2 = new Vector2();
    private clickHandler?: (event: MouseEvent) => void;

    // Outline system - expects outline-effect element to be present in HTML
    private outlineEffect: HTMLElement | null = null;

    // Snap point system
    private snapPointsGroup: Group | null = null; // Container for all snap point visualizations
    private snapPointSpheres: Set<Mesh> = new Set(); // Track all snap point sphere meshes

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

    private setupOutlineSystem() {
      // Look for an outline-effect element that should be provided by the HTML page
      this.outlineEffect = this.querySelector('outline-effect');

      if (!this.outlineEffect) {
        console.warn(
          'ld-puzzler: No outline-effect element found. Outline functionality will be disabled. Please add <outline-effect> inside your <model-viewer> element.'
        );
        return;
      }

      console.log(
        'Found outline-effect element, outline functionality enabled'
      );
    }

    private updateOutlineSelection() {
      // Initialize outline system if not already done
      if (!this.outlineEffect) {
        this.setupOutlineSystem();
      }

      if (!this.outlineEffect) return;

      // Update the selection in the outline effect
      if (this.selectedObjects.length > 0) {
        // Collect all mesh objects from selected groups/objects for outline rendering
        const meshesToOutline = this.collectMeshesFromObjects(
          this.selectedObjects
        );

        // Set the mesh objects as the selection for outline rendering
        (this.outlineEffect as any).selection = meshesToOutline;
        // Use default blend-mode when objects are selected (enable outline rendering)
        this.outlineEffect.setAttribute('blend-mode', 'default');
      } else {
        // When no objects are selected, use skip mode to disable outline completely
        this.outlineEffect.setAttribute('blend-mode', 'skip');
        // Clear the selection to avoid any lingering selection state
        (this.outlineEffect as any).selection = [];
      }

      this[$needsRender]();
    }

    /**
     * Efficiently collect all mesh objects from a list of objects (Groups or Meshes).
     * This method supports both individual objects and future multi-object selections.
     */
    private collectMeshesFromObjects(objects: Object3D[]): Object3D[] {
      const meshes: Object3D[] = [];

      objects.forEach((obj) => {
        if (obj.type === 'Mesh') {
          meshes.push(obj);
        } else if (obj.type === 'Group') {
          // Use pre-cached meshes if available for better performance
          if (obj.userData.meshes && Array.isArray(obj.userData.meshes)) {
            meshes.push(...obj.userData.meshes);
          } else {
            // Fallback: traverse and collect all mesh children
            obj.traverse((child) => {
              if (child.type === 'Mesh') {
                meshes.push(child);
              }
            });
          }
        }
      });

      return meshes;
    }

    /**
     * Enhanced method for selecting multiple objects (for future multi-selection support).
     * Currently supports single selection but designed to be easily extended.
     */
    private selectObjects(objects: Object3D[]) {
      // Clear previous selection
      this.deselectObject();

      this.selectedObjects = [...objects];

      // Track groups separately for potential future grouping operations
      objects.forEach((obj) => {
        if (obj.type === 'Group') {
          this.selectedGroups.add(obj);
        }
      });

      // Update outline selection
      this.updateOutlineSelection();

      // Disable camera panning while objects are selected
      if (this[$controls]) {
        this[$controls].enablePan = false;
      }

      this[$needsRender]();
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
        // Return the cursor's local position relative to its parent (target object)
        // This is the coordinate system where objects are placed
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
            const objectName =
              options.name ||
              `part__${Math.random().toString(36).substring(2, 9)}`;
            gltf.scene.name = 'part__' + objectName;

            // Parse metadata from the object name
            const nameMetadata = this.parseNameMetadata(objectName);

            // Add metadata for future grouping and selection optimization
            gltf.scene.userData = {
              ...gltf.scene.userData,
              isPlacedObject: true,
              groupId: nameMetadata.groupId,
              tags: nameMetadata.tags,
              instanceId: nameMetadata.instanceId,
              placedAt: Date.now(),
            };

            // Handle snap points
            if (options.snapPoints && options.snapPoints.length > 0) {
              // Use provided snap points
              gltf.scene.userData.snapPoints = options.snapPoints;
            } else {
              // Generate default snap points if none provided
              // We'll generate them after the object is positioned and added to the scene
              gltf.scene.userData.needsDefaultSnapPoints = true;
            }

            // Pre-cache mesh references for efficient outline selection
            const meshes: Object3D[] = [];
            gltf.scene.traverse((child) => {
              if (child.type === 'Mesh') {
                meshes.push(child);
              }
            });
            gltf.scene.userData.meshes = meshes;
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

              // Initialize outline system on first GLB placement
              if (!this.outlineEffect) {
                this.setupOutlineSystem();
              }

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
                  // Generate default snap points if needed (after object is in final position)
                  if (gltf.scene.userData.needsDefaultSnapPoints) {
                    gltf.scene.userData.snapPoints =
                      this.generateDefaultSnapPoints(gltf.scene);
                    delete gltf.scene.userData.needsDefaultSnapPoints;
                  }

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

    private setupDragHandlers() {
      // Mouse/touch event handlers for custom dragging
      this.addEventListener('mousedown', this.onMouseDown.bind(this));
      this.addEventListener('mousemove', this.onMouseMove.bind(this));
      this.addEventListener('mouseup', this.onMouseUp.bind(this));

      // Touch events for mobile support
      this.addEventListener('touchstart', this.onTouchStart.bind(this));
      this.addEventListener('touchmove', this.onTouchMove.bind(this));
      this.addEventListener('touchend', this.onTouchEnd.bind(this));

      // Prevent context menu on right click
      this.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Camera control state storage
    private originalSensitivities = {
      orbit: 1,
      zoom: 1,
      pan: 1,
      input: 1,
    };

    private onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return; // Only handle left mouse button

      this.updateMousePosition(event);
      this.lastClickTime = performance.now();
      this.lastClickPosition.copy(this.currentMousePosition);

      // Check if we're clicking on the selected object
      if (this.selectedObjects.length) {
        const isOnSelectedObject = this.selectedObjects.some((obj) =>
          this.isPointOnObject(this.currentMousePosition, obj)
        );
        if (isOnSelectedObject) {
          event.stopImmediatePropagation();
          event.preventDefault();
          this.startDragging(event);
          return;
        }
      }

      // Check if we're clicking on any part object to potentially select it
      const partObject = this.getPartObjectAtPosition(
        this.currentMousePosition
      );
      if (partObject) {
        event.stopImmediatePropagation();
        event.preventDefault();
        // Selection will be handled on mouseup
      }
    }

    private onMouseMove(event: MouseEvent) {
      this.updateMousePosition(event);

      if (this.isDragging && this.selectedObjects.length) {
        this.updateDragPosition();
      }
    }

    private onMouseUp(event: MouseEvent) {
      if (this.isDragging) {
        this.stopDragging();
      } else {
        // Handle selection only if we're not dragging and it was a quick click
        const timeSinceMouseDown = performance.now() - this.lastClickTime;
        const distanceFromMouseDown = this.currentMousePosition.distanceTo(
          this.lastClickPosition
        );

        if (timeSinceMouseDown < 300 && distanceFromMouseDown < 5) {
          // Check if we clicked on a part object
          const partObject = this.getPartObjectAtPosition(
            this.currentMousePosition
          );
          if (partObject) {
            // Handle selection for part objects
            this.handleSelection(event);
          } else {
            // Clicked on empty space - deselect any selected object
            this.deselectObject();
          }
        }
      }
      // No need to restore panSensitivity here; controls are unaffected
    }

    private onTouchStart(event: TouchEvent) {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);
        this.lastClickTime = performance.now();
        this.lastClickPosition.copy(this.currentMousePosition);

        if (this.selectedObjects.length) {
          const isOnSelectedObject = this.selectedObjects.some((obj) =>
            this.isPointOnObject(this.currentMousePosition, obj)
          );
          if (isOnSelectedObject) {
            event.stopImmediatePropagation();
            event.preventDefault();
            this.startDragging();
            return;
          }
        }

        // Check if we're touching any part object to potentially select it
        const partObject = this.getPartObjectAtPosition(
          this.currentMousePosition
        );
        if (partObject) {
          event.stopImmediatePropagation();
          event.preventDefault();
          // Selection will be handled on touchend
        }
      }
    }

    private onTouchMove(event: TouchEvent) {
      if (event.touches.length === 1 && this.isDragging) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);
        this.updateDragPosition();
        event.preventDefault();
      }
    }

    private onTouchEnd(event: TouchEvent) {
      if (this.isDragging) {
        this.stopDragging();
      } else if (event.changedTouches.length === 1) {
        // Handle tap selection
        const touch = event.changedTouches[0];
        this.updateMousePositionFromTouch(touch);

        const timeSinceMouseDown = performance.now() - this.lastClickTime;
        const distanceFromMouseDown = this.currentMousePosition.distanceTo(
          this.lastClickPosition
        );

        if (timeSinceMouseDown < 300 && distanceFromMouseDown < 5) {
          this.handleSelection();
        }
      }
    }

    private updateMousePosition(event: MouseEvent) {
      const rect = this.getBoundingClientRect();
      this.currentMousePosition.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private updateMousePositionFromTouch(touch: Touch) {
      const rect = this.getBoundingClientRect();
      this.currentMousePosition.x =
        ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y =
        -((touch.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private isPointOnObject(mousePosition: Vector2, object: Object3D): boolean {
      this.raycaster.setFromCamera(mousePosition, this[$scene].camera);

      const intersects = this.raycaster.intersectObject(object, true);
      return intersects.length > 0;
    }

    private getPartObjectAtPosition(mousePosition: Vector2): Object3D | null {
      this.raycaster.setFromCamera(mousePosition, this[$scene].camera);

      const targetObject = this.findTargetObject();
      if (!targetObject) return null;

      // Get all part objects (those with "part__" prefix)
      const partObjects: Object3D[] = [];
      targetObject.traverse((child) => {
        if (child.name && child.name.startsWith('part__')) {
          partObjects.push(child);
        }
      });

      const intersects = this.raycaster.intersectObjects(partObjects, true);

      if (intersects.length > 0) {
        // Find the top-level part object (not a child mesh)
        let selectedPart = intersects[0].object;
        while (selectedPart.parent && !selectedPart.name.startsWith('part__')) {
          selectedPart = selectedPart.parent;
        }

        if (selectedPart.name && selectedPart.name.startsWith('part__')) {
          return selectedPart;
        }
      }

      return null;
    }

    private startDragging(event?: MouseEvent | TouchEvent) {
      if (!this.selectedObjects.length) return;

      this.isDragging = true;
      this.dragStartMousePosition.copy(this.currentMousePosition);
      this.dragStartPosition.copy(this.selectedObjects[0].position);

      // Calculate the offset between the object position and where we clicked
      // Cast a ray to the floor plane to find where we clicked
      this.raycaster.setFromCamera(
        this.currentMousePosition,
        this[$scene].camera
      );

      // Update floor plane to current floor level
      if (this.originalFloorY !== undefined) {
        this.floorPlane.constant = -this.originalFloorY;
      }

      const clickPoint = new Vector3();
      if (this.raycaster.ray.intersectPlane(this.floorPlane, clickPoint)) {
        // Calculate offset from object position to click point (only X and Z)
        this.dragOffset.set(
          this.selectedObjects[0].position.x - clickPoint.x,
          0,
          this.selectedObjects[0].position.z - clickPoint.z
        );
      } else {
        // Fallback: no offset
        this.dragOffset.set(0, 0, 0);
      }

      // Store original sensitivities and disable all camera interactions while dragging
      if (this[$controls]) {
        this.originalSensitivities.orbit = this[$controls].orbitSensitivity;
        this.originalSensitivities.zoom = this[$controls].zoomSensitivity;
        this.originalSensitivities.pan = this[$controls].panSensitivity;
        this.originalSensitivities.input = this[$controls].inputSensitivity;

        this[$controls].orbitSensitivity = 0;
        this[$controls].zoomSensitivity = 0;
        this[$controls].panSensitivity = 0;
        this[$controls].inputSensitivity = 0;
      }

      // Change cursor to indicate dragging
      this.style.cursor = 'grabbing';

      console.log(
        `Started dragging: ${this.selectedObjects
          .map((obj) => obj.name)
          .join(', ')}`
      );
    }

    private updateDragPosition() {
      if (!this.isDragging || this.selectedObjects.length === 0) return;

      // Cast ray from current mouse position
      this.raycaster.setFromCamera(
        this.currentMousePosition,
        this[$scene].camera
      );

      const object = this.selectedObjects[0]; // Assuming single selection for now

      // Find intersection with floor plane
      const intersectionPoint = new Vector3();
      if (
        this.raycaster.ray.intersectPlane(this.floorPlane, intersectionPoint)
      ) {
        // Apply the drag offset to maintain the relative position
        object.position.x = intersectionPoint.x + this.dragOffset.x;
        object.position.z = intersectionPoint.z + this.dragOffset.z;
        // Keep the lifted Y position
        object.position.y = this.originalFloorY || 0;

        this[$scene].updateShadow();
        this[$needsRender]();
      }
    }

    private stopDragging() {
      if (!this.isDragging) return;

      this.isDragging = false;

      // Restore original sensitivities
      if (this[$controls]) {
        this[$controls].orbitSensitivity = this.originalSensitivities.orbit;
        this[$controls].zoomSensitivity = this.originalSensitivities.zoom;
        this[$controls].panSensitivity = this.originalSensitivities.pan;
        this[$controls].inputSensitivity = this.originalSensitivities.input;
      }

      // Reset cursor
      this.style.cursor = '';
    }

    private handleSelection(event?: MouseEvent | TouchEvent) {
      const selectedPart = this.getPartObjectAtPosition(
        this.currentMousePosition
      );

      if (selectedPart) {
        // Toggle selection if clicking the same object, otherwise select new object
        if (
          this.selectedObjects.length === 1 &&
          this.selectedObjects[0] === selectedPart
        ) {
          this.deselectObject();
        } else {
          this.selectObject(selectedPart);
        }
      } else {
        this.deselectObject();
      }
    }

    private selectObject(object: Object3D) {
      // Deselect previous object
      this.deselectObject();

      this.selectedObjects = [object];

      // Update outline selection
      this.updateOutlineSelection();

      // Show snap points for all objects when any object is selected
      this.showAllSnapPoints();

      // Disable camera panning while a part is selected
      if (this[$controls]) {
        this[$controls].enablePan = false;
      }

      this[$needsRender]();
    }

    private deselectObject() {
      if (this.selectedObjects.length > 0) {
        this.selectedObjects = [];
        this.selectedGroups.clear(); // Clear group tracking

        // Update outline selection
        this.updateOutlineSelection();

        // Hide snap points when no object is selected
        this.hideAllSnapPoints();

        this[$needsRender]();
      }
      // Re-enable camera panning when no part is selected
      if (this[$controls]) {
        this[$controls].enablePan = true;
      }
    }

    /**
     * Get all objects by group ID for future multi-object grouping support.
     */
    private getObjectsByGroupId(groupId: string): Object3D[] {
      const objects: Object3D[] = [];
      const targetObject = this.findTargetObject();
      if (!targetObject) return objects;

      targetObject.traverse((child) => {
        if (
          child.userData.groupId === groupId &&
          child.userData.isPlacedObject
        ) {
          objects.push(child);
        }
      });

      return objects;
    }

    /**
     * Get all objects by tags for future batch operations.
     */
    private getObjectsByTags(tags: string[]): Object3D[] {
      const objects: Object3D[] = [];
      const targetObject = this.findTargetObject();
      if (!targetObject) return objects;

      targetObject.traverse((child) => {
        if (child.userData.isPlacedObject && child.userData.tags) {
          const hasMatchingTag = tags.some((tag) =>
            child.userData.tags.includes(tag)
          );
          if (hasMatchingTag) {
            objects.push(child);
          }
        }
      });

      return objects;
    }

    /**
     * Future method for selecting objects by group ID (for multi-object grouping).
     */
    private selectObjectsByGroupId(groupId: string) {
      const objects = this.getObjectsByGroupId(groupId);
      if (objects.length > 0) {
        this.selectObjects(objects);
      }
    }

    /**
     * Parse grouping information from object name.
     * Supports naming conventions like:
     * - "chair_01" -> groupId: "chair", instanceId: "01"
     * - "table-wood_large" -> groupId: "table-wood", instanceId: "large"
     * - "car#red_001" -> groupId: "car", tags: ["red"], instanceId: "001"
     */
    private parseNameMetadata(name: string): {
      groupId: string;
      tags: string[];
      instanceId: string;
    } {
      // Extract tags from # syntax: "car#red_001" -> groupId: "car", tags: ["red"], instanceId: "001"
      const tagMatch = name.match(/^([^#]+)#([^_]+)_(.+)$/);
      if (tagMatch) {
        return {
          groupId: tagMatch[1],
          tags: [tagMatch[2]],
          instanceId: tagMatch[3],
        };
      }

      // Extract groupId and instanceId from _ syntax: "chair_01" -> groupId: "chair", instanceId: "01"
      const groupMatch = name.match(/^(.+)_([^_]+)$/);
      if (groupMatch) {
        return {
          groupId: groupMatch[1],
          tags: [],
          instanceId: groupMatch[2],
        };
      }

      // No special syntax, use the full name as groupId
      return {
        groupId: name,
        tags: [],
        instanceId: '',
      };
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

      // Set up custom selection and drag handlers
      this.setupDragHandlers();
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this.removeEventListener('load', this._handleLoad);
      this.removeEventListener('progress', this._handleProgress);

      // Clean up our custom event handlers
      this.removeEventListener('mousedown', this.onMouseDown.bind(this));
      this.removeEventListener('mousemove', this.onMouseMove.bind(this));
      this.removeEventListener('mouseup', this.onMouseUp.bind(this));
      this.removeEventListener('touchstart', this.onTouchStart.bind(this));
      this.removeEventListener('touchmove', this.onTouchMove.bind(this));
      this.removeEventListener('touchend', this.onTouchEnd.bind(this));

      // Clean up selection state
      this.deselectObject();

      // Clean up snap points
      this.hideAllSnapPoints();

      if (this.cursor) {
        this.cursor.cleanup();
      }
    }

    /**
     * Generate default snap points on the middle of each side of the bounding box.
     * Creates snap points on front, back, left, and right sides (not top or bottom).
     */
    private generateDefaultSnapPoints(
      object: Object3D
    ): { x: number; y: number; z: number }[] {
      const boundingBox = new Box3().setFromObject(object);
      const center = boundingBox.getCenter(new Vector3());
      const size = boundingBox.getSize(new Vector3());

      // Convert to local coordinates relative to object center
      const localCenter = object.worldToLocal(center.clone());

      return [
        // Front side (positive Z)
        { x: localCenter.x, y: localCenter.y, z: localCenter.z + size.z / 2 },
        // Back side (negative Z)
        { x: localCenter.x, y: localCenter.y, z: localCenter.z - size.z / 2 },
        // Right side (positive X)
        { x: localCenter.x + size.x / 2, y: localCenter.y, z: localCenter.z },
        // Left side (negative X)
        { x: localCenter.x - size.x / 2, y: localCenter.y, z: localCenter.z },
      ];
    }

    /**
     * Initialize the snap point visualization system.
     */
    private setupSnapPointSystem() {
      if (!this.snapPointsGroup) {
        this.snapPointsGroup = new Group();
        this.snapPointsGroup.name = 'SnapPointsGroup';

        const targetObject = this.findTargetObject();
        if (targetObject) {
          targetObject.add(this.snapPointsGroup);
        }
      }
    }

    /**
     * Create a visual snap point sphere.
     */
    private createSnapPointSphere(position: Vector3): Mesh {
      const geometry = new SphereGeometry(SNAP_POINT_DIAMETER / 2, 16, 12);
      const material = new MeshBasicMaterial({
        color: 0xffffff, // White color
        transparent: true,
        opacity: 0.8,
      });

      const sphere = new Mesh(geometry, material);
      sphere.position.copy(position);
      sphere.name = 'SnapPointSphere';

      return sphere;
    }

    /**
     * Show snap points for all objects that have snap points.
     */
    private showAllSnapPoints() {
      this.hideAllSnapPoints(); // Clear existing snap points first

      if (!this.snapPointsGroup) {
        this.setupSnapPointSystem();
      }

      const targetObject = this.findTargetObject();
      if (!targetObject || !this.snapPointsGroup) return;

      // Find all objects with snap points
      targetObject.traverse((child) => {
        if (child.userData.isPlacedObject && child.userData.snapPoints) {
          const snapPoints = child.userData.snapPoints as {
            x: number;
            y: number;
            z: number;
          }[];

          snapPoints.forEach((localPoint) => {
            // Convert local snap point to world position
            const worldPoint = child.localToWorld(
              new Vector3(localPoint.x, localPoint.y, localPoint.z)
            );
            // Convert world position to target object's local space
            const targetLocalPoint = targetObject.worldToLocal(worldPoint);

            const sphere = this.createSnapPointSphere(targetLocalPoint);
            this.snapPointsGroup!.add(sphere);
            this.snapPointSpheres.add(sphere);
          });
        }
      });

      this[$needsRender]();
    }

    /**
     * Hide all snap point visualizations.
     */
    private hideAllSnapPoints() {
      if (this.snapPointsGroup) {
        // Remove all spheres from the group
        this.snapPointSpheres.forEach((sphere) => {
          this.snapPointsGroup!.remove(sphere);
          sphere.geometry.dispose();
          if (sphere.material instanceof MeshBasicMaterial) {
            sphere.material.dispose();
          }
        });
        this.snapPointSpheres.clear();
      }

      this[$needsRender]();
    }

    // ...existing code...
  }

  return LDPuzzlerModelViewerElement;
};
