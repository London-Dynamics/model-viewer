// @ts-nocheck

declare global {
  interface Window {
    deDraco: any;
  }
}

import {
  Box3,
  BoxGeometry,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  TextureLoader,
  Vector2,
  Vector3,
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
  $tick,
} from '../../model-viewer-base.js';
import { $controls } from '../controls.js';
import { $selectObjectForControls } from '../ld-floating-control-strip.js';

import { Constructor } from '../../utilities.js';
import { createSafeObjectUrlFromArrayBuffer } from '../../utilities/create_object_url.js';
import { animateGravityFallSmooth } from '../../utilities/animation.js';
import {
  SnappingPoint,
  generateDefaultSnappingPoints,
  SNAP_POINT_DIAMETER,
  DEFAULT_SNAP_ATTRACTION,
  getSnappingPointWorldPosition,
  findSnappingConnections,
  createSnappedGroup,
  isInSnappedGroup,
  getSnappedGroup,
} from '../../utilities/snapping-points.js';
import { Cursor } from './cursor.js';
import { updateSlots, createSlotElement, SlotUpdateItem } from './slots.js';

const DROP_HEIGHT = 0.5; // Height to drop models from when placed

// Re-export SnappingPoint type for external use
export type { SnappingPoint };

export type PlacementOptions = {
  name?: string;
  position?: { x: number; y: number; z: number };
  mass?: number; // Mass in kg, affects fall speed
  floorOffset?: number; // Additional Y offset from calculated floor position (e.g., 0.5 for center-positioned cubes)
  snappingPoints?: SnappingPoint[]; // Optional snap points with position and rotation relative to object center
};

export declare interface LDPuzzlerInterface {
  placementCursor: boolean;
  placementCursorSize: number;
  setSrcFromBuffer(buffer: ArrayBuffer): void;
  placeGLB(src: string, options?: PlacementOptions): Promise<void>;
  getPlacementCursorPosition(): { x: number; y: number; z: number } | null;
  rotateSelected(deg?: number): void;
  deleteSelected(): void;
  deleteObjectByFileName(filename: string): void;
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
 * - If no snappingPoints are provided in PlacementOptions, default snap points are generated
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
    private snappingPointSpheres: Set<Mesh> = new Set(); // Track all snap point sphere meshes
    private snappingEnabled: boolean = true; // Allow disabling snapping
    private pendingSnapConnection: {
      draggedObject: Object3D;
      targetObject: Object3D;
      draggedPoint: SnappingPoint;
      targetPoint: SnappingPoint;
    } | null = null;

    // Slot-based snapping point rendering
    private snappingPointSlots: Map<string, HTMLElement> = new Map();
    private snappingPointsVisible: boolean = false;

    // Slot-based ungroup button rendering
    // Break link slot management for multiple connection points
    private breakLinkSlots: Map<string, HTMLElement> = new Map();
    private breakLinkSlotsVisible: boolean = false;

    // Slot-based rotation controls rendering
    private rotationSlots: Map<string, HTMLElement> = new Map();
    private rotationSlotsVisible: boolean = false;

    // Animation properties for rotation

    /**
     * Updates the visibility and positioning of snapping point slot elements.
     * Creates DOM elements for each visible snapping point and positions them
     * at the correct 2D screen coordinates. Also applies opacity based on
     * whether the snapping point is facing the camera or behind the model.
     */
    private updateSnappingPointSlots() {
      if (!this.snappingPointsVisible) {
        this.snappingPointSlots.forEach((element) => {
          element.style.display = 'none';
        });
        return;
      }

      const scene = this[$scene];
      const camera = scene.getCamera();
      if (!camera) return;

      const snappingPointsFound: SlotUpdateItem[] = [];
      const targetObject = this.findTargetObject();

      if (targetObject) {
        targetObject.traverse((child) => {
          if (child.userData.isPlacedObject && child.userData.snappingPoints) {
            const snappingPoints = child.userData
              .snappingPoints as SnappingPoint[];
            snappingPoints.forEach((snapPoint, index) => {
              if (snapPoint.isUsed) return;

              const localPos = new Vector3(
                snapPoint.position.x,
                snapPoint.position.y,
                snapPoint.position.z
              );
              const worldPos = child.localToWorld(localPos.clone());

              const rotation = new Euler(
                snapPoint.rotation.x,
                snapPoint.rotation.y,
                snapPoint.rotation.z
              );
              const normal = new Vector3(0, 0, 1).applyEuler(rotation);
              const worldNormal = normal
                .clone()
                .transformDirection(child.matrixWorld);

              const viewVector = new Vector3()
                .copy(camera.position)
                .sub(worldPos);
              const dotProduct = viewVector.dot(worldNormal);
              const facingCamera = dotProduct > 0;

              snappingPointsFound.push({
                name: `${child.uuid}_${index}`,
                worldPosition: worldPos,
                isFacingCamera: facingCamera,
              });
            });
          }
        });
      }

      updateSlots(snappingPointsFound, {
        slotMap: this.snappingPointSlots,
        owner: this,
        container: this.shadowRoot?.querySelector('.slot.ld-puzzler'),
        scene,
        camera,
        onCreate: (item) => {
          const element = createSlotElement(
            'ld-snapping-point',
            '', // No inline styles - handled by CSS
            'snapping-point',
            this.shadowRoot,
            null // Content handled by slot template
          );
          return element;
        },
        onUpdate: (element, item) => {
          if (item.isFacingCamera) {
            element.classList.remove('back-facing');
          } else {
            element.classList.add('back-facing');
          }
        },
      });
    }

    /**
     * Show or hide snapping point slots
     */
    private setSnappingPointSlotsVisible(visible: boolean) {
      this.snappingPointsVisible = visible;
      this.updateSnappingPointSlots();
    }

    /**
     * Remove all snapping point slots
     */
    private clearSnappingPointSlots() {
      this.clearSlots(this.snappingPointSlots);
    }

    /**
     * Updates the visibility and positioning of the ungroup slot element.
     * Shows the ungroup button at the connection point between two snapped objects.
     */

    /**
     * Updates the visibility and positioning of break link slot elements.
     * Creates DOM elements for each snap connection and positions them
     * at the center point between the connected objects.
     */
    private updateBreakLinkSlots() {
      if (!this.breakLinkSlotsVisible || this.selectedObjects.length === 0) {
        this.breakLinkSlots.forEach((slot) => {
          slot.style.display = 'none';
        });
        return;
      }

      const scene = this[$scene];
      const camera = scene.getCamera();
      if (!camera) return;

      const selectedGroup = this.selectedObjects[0];
      if (
        !selectedGroup.userData.isSnappedGroup ||
        !selectedGroup.userData.snapConnections
      ) {
        this.breakLinkSlots.forEach((slot) => {
          slot.style.display = 'none';
        });
        return;
      }

      const slotItems: SlotUpdateItem[] = selectedGroup.userData.snapConnections
        .map((snapConnection: any, index: number) => {
          const connectionId = `connection-${index}`;
          if (!snapConnection.object1 || !snapConnection.object2) {
            return null;
          }

          const point1WorldPos = getSnappingPointWorldPosition(
            snapConnection.object1,
            snapConnection.snapPoint1
          );
          const point2WorldPos = getSnappingPointWorldPosition(
            snapConnection.object2,
            snapConnection.snapPoint2
          );

          const midpoint = new Vector3()
            .addVectors(point1WorldPos, point2WorldPos)
            .multiplyScalar(0.5);

          return {
            name: connectionId,
            worldPosition: midpoint,
            data: { connectionId },
          };
        })
        .filter((item) => item !== null) as SlotUpdateItem[];

      updateSlots(slotItems, {
        slotMap: this.breakLinkSlots,
        owner: this,
        container: this.shadowRoot?.querySelector('.slot.ld-puzzler'),
        scene,
        camera,
        onCreate: (item) => {
          const element = createSlotElement(
            'ld-break-link',
            '', // No inline styles - handled by CSS
            'break-link',
            this.shadowRoot,
            null // Content handled by slot template
          );

          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.breakSpecificConnection(item.data.connectionId);
          });

          return element;
        },
        onUpdate: (element, item) => {
          element.style.zIndex = '20'; // Ensure it's on top
        },
      });
    }

    /**
     * Show or hide the break link slots
     */
    private setBreakLinkSlotsVisible(visible: boolean) {
      this.breakLinkSlotsVisible = visible;
      this.updateBreakLinkSlots();
    }

    /**
     * Remove all break link slots
     */
    private clearBreakLinkSlots() {
      this.clearSlots(this.breakLinkSlots);
    }

    /**
     * Break a specific connection identified by its ID
     */
    private breakSpecificConnection(connectionId: string) {
      if (this.selectedObjects.length !== 1) return;

      const selectedGroup = this.selectedObjects[0];
      if (
        !selectedGroup.userData.isSnappedGroup ||
        !selectedGroup.userData.snapConnections
      ) {
        return;
      }

      // Parse the connection index from the ID
      const index = parseInt(connectionId.replace('connection-', ''));
      const connections = selectedGroup.userData.snapConnections;

      if (index < 0 || index >= connections.length) {
        return;
      }

      const connectionToBreak = connections[index];

      // Mark the snap points as no longer used
      if (connectionToBreak.snapPoint1) {
        connectionToBreak.snapPoint1.isUsed = false;
      }
      if (connectionToBreak.snapPoint2) {
        connectionToBreak.snapPoint2.isUsed = false;
      }

      // Remove this connection from the group's connections
      connections.splice(index, 1);

      // Clear break link slots immediately to prevent floating buttons
      this.clearBreakLinkSlots();
      this.setBreakLinkSlotsVisible(false);

      // If this was the last connection, ungroup everything
      if (connections.length === 0) {
        this.ungroupSelectedObject();
        return;
      }

      // Otherwise, we need to reorganize the group structure
      this.reorganizeGroupAfterBreakLink(selectedGroup, connectionToBreak);

      // Trigger render update
      this[$needsRender]();
    }

    /**
     * Reorganize the group structure after breaking a specific link
     */
    private reorganizeGroupAfterBreakLink(
      group: Object3D,
      brokenConnection: any
    ) {
      const targetObject = this.findTargetObject();
      if (!targetObject) return;

      // Find which objects are still connected through remaining connections
      const remainingConnections = group.userData.snapConnections;
      const connectedObjectSets: Set<Object3D>[] = [];

      // Build connected component sets
      remainingConnections.forEach((connection: any) => {
        const obj1 = connection.object1;
        const obj2 = connection.object2;

        // Find if either object is already in a set
        let set1 = connectedObjectSets.find((set) => set.has(obj1));
        let set2 = connectedObjectSets.find((set) => set.has(obj2));

        if (set1 && set2 && set1 !== set2) {
          // Merge the two sets
          set2.forEach((obj) => set1!.add(obj));
          const index = connectedObjectSets.indexOf(set2);
          connectedObjectSets.splice(index, 1);
        } else if (set1) {
          set1.add(obj2);
        } else if (set2) {
          set2.add(obj1);
        } else {
          // Create new set with both objects
          const newSet = new Set([obj1, obj2]);
          connectedObjectSets.push(newSet);
        }
      });

      // Get all child objects and save their world transforms before removing them
      const childObjects = [...group.children];
      const worldTransforms = new Map();

      // Save world transforms for all objects while they're still in the original group
      childObjects.forEach((child) => {
        const worldPosition = new Vector3();
        const worldQuaternion = new Quaternion();
        const worldScale = new Vector3();
        child.getWorldPosition(worldPosition);
        child.getWorldQuaternion(worldQuaternion);
        child.getWorldScale(worldScale);
        worldTransforms.set(child, {
          position: worldPosition,
          quaternion: worldQuaternion,
          scale: worldScale,
        });
      });

      // Make sure all child objects are accounted for in some set
      // Objects not in any remaining connections become individual objects
      childObjects.forEach((child) => {
        const isInAnySet = connectedObjectSets.some((set) => set.has(child));
        if (!isInAnySet) {
          // Create a singleton set for this object
          const singletonSet = new Set([child]);
          connectedObjectSets.push(singletonSet);
        }
      });

      // Remove all children from the current group
      childObjects.forEach((child) => group.remove(child));

      // Remove the current group from its parent
      if (group.parent) {
        group.parent.remove(group);
      }

      // Clear selection before creating new groups
      this.selectedObjects = [];

      if (connectedObjectSets.length === 1) {
        // All remaining objects are still connected - create one new group
        const newGroup = new Group();
        newGroup.name = `SnappedGroup_${Date.now()}`;
        newGroup.userData.isSnappedGroup = true;

        // Add to target first
        targetObject.add(newGroup);

        connectedObjectSets[0].forEach((obj) => {
          // Get saved world transform
          const transform = worldTransforms.get(obj);
          if (transform) {
            // Add to new group
            newGroup.add(obj);

            // Convert world position to new group's local coordinate system
            const localPosition = transform.position.clone();
            newGroup.worldToLocal(localPosition);
            obj.position.copy(localPosition);
            obj.quaternion.copy(transform.quaternion);
            obj.scale.copy(transform.scale);
          } else {
            newGroup.add(obj);
          }
        });

        // Copy the remaining connections to the new group
        newGroup.userData.snapConnections = [...remainingConnections];

        // Copy other userData from the original group
        newGroup.userData.isPlacedObject = true;
        newGroup.userData.meshes = [];
        newGroup.traverse((child) => {
          if (child.type === 'Mesh' && child.name !== 'SnappingPointSphere') {
            newGroup.userData.meshes.push(child);
          }
        });

        // Select the new group
        this.selectObject(newGroup);
      } else if (connectedObjectSets.length > 1) {
        // Multiple disconnected groups - create separate groups
        let firstGroupOrObject: Object3D | null = null;

        connectedObjectSets.forEach((objectSet) => {
          if (objectSet.size > 1) {
            // Create a new group for multiple connected objects
            const newGroup = new Group();
            newGroup.name = `SnappedGroup_${Date.now()}`;
            newGroup.userData.isSnappedGroup = true;

            // Add to target first
            targetObject.add(newGroup);

            objectSet.forEach((obj) => {
              // Get saved world transform
              const transform = worldTransforms.get(obj);
              if (transform) {
                // Add to new group
                newGroup.add(obj);

                // Convert world position to new group's local coordinate system
                const localPosition = transform.position.clone();
                newGroup.worldToLocal(localPosition);
                obj.position.copy(localPosition);
                obj.quaternion.copy(transform.quaternion);
                obj.scale.copy(transform.scale);
              } else {
                newGroup.add(obj);
              }
            });

            // Find connections that belong to this group
            const groupConnections = remainingConnections.filter(
              (connection: any) =>
                objectSet.has(connection.object1) &&
                objectSet.has(connection.object2)
            );
            newGroup.userData.snapConnections = groupConnections;

            // Set up group userData
            newGroup.userData.isPlacedObject = true;
            newGroup.userData.meshes = [];
            newGroup.traverse((child) => {
              if (
                child.type === 'Mesh' &&
                child.name !== 'SnappingPointSphere'
              ) {
                newGroup.userData.meshes.push(child);
              }
            });

            if (!firstGroupOrObject) {
              firstGroupOrObject = newGroup;
            }
          } else {
            // Single object - add directly to target using the same logic as ungroupSnappedGroup
            const obj = objectSet.values().next().value;

            // Get saved world transform
            const transform = worldTransforms.get(obj);
            if (transform) {
              // Add to target and restore transform
              targetObject.add(obj);

              // Convert world position to local space of the target object
              const localPosition = transform.position.clone();
              targetObject.worldToLocal(localPosition);
              obj.position.copy(localPosition);
              obj.quaternion.copy(transform.quaternion);
              obj.scale.copy(transform.scale);
            } else {
              targetObject.add(obj);
            }

            // Restore as individual placed object
            obj.userData.isPlacedObject = true;
            delete obj.userData.isInGroup;

            // Ensure meshes array is set up for individual objects
            obj.userData.meshes = [];
            obj.traverse((child) => {
              if (
                child.type === 'Mesh' &&
                child.name !== 'SnappingPointSphere'
              ) {
                obj.userData.meshes.push(child);
              }
            });

            // Reset snapping points to fresh defaults for orphaned objects
            // This ensures all snapping points are available for new connections
            obj.userData.snappingPoints = generateDefaultSnappingPoints(obj);

            if (!firstGroupOrObject) {
              firstGroupOrObject = obj;
            }
          }
        });

        // Select the first object/group
        if (firstGroupOrObject) {
          this.selectObject(firstGroupOrObject);
        }
      } else {
        // No remaining connections - place all objects individually using the same logic as ungroupSnappedGroup
        childObjects.forEach((child) => {
          // Get saved world transform
          const transform = worldTransforms.get(child);
          if (transform) {
            // Add to target and restore transform
            targetObject.add(child);

            // Convert world position to local space of the target object
            const localPosition = transform.position.clone();
            targetObject.worldToLocal(localPosition);
            child.position.copy(localPosition);
            child.quaternion.copy(transform.quaternion);
            child.scale.copy(transform.scale);
          } else {
            targetObject.add(child);
          }

          child.userData.isPlacedObject = true;
          delete child.userData.isInGroup;

          // Ensure meshes array is set up for individual objects
          child.userData.meshes = [];
          child.traverse((grandchild) => {
            if (
              grandchild.type === 'Mesh' &&
              grandchild.name !== 'SnappingPointSphere'
            ) {
              child.userData.meshes.push(grandchild);
            }
          });

          // Reset snapping points to fresh defaults for orphaned objects
          // This ensures all snapping points are available for new connections
          child.userData.snappingPoints = generateDefaultSnappingPoints(child);
        });

        // Select the first object
        if (childObjects.length > 0) {
          this.selectObject(childObjects[0]);
        }
      }

      // Force update of snapping point slots and break link slots after reorganization
      setTimeout(() => {
        // Always update snapping points for all objects
        this.setSnappingPointSlotsVisible(true);
        this.updateSnappingPointSlots();

        // Show break link slots if we still have a group selected
        if (
          this.selectedObjects.length > 0 &&
          this.selectedObjects[0].userData.isSnappedGroup
        ) {
          this.setBreakLinkSlotsVisible(true);
          this.updateBreakLinkSlots();
        } else {
          // Hide break link slots if no group is selected
          this.setBreakLinkSlotsVisible(false);
        }

        // Force re-render to ensure all snapping points are visible
        this.dispatchEvent(new CustomEvent('render'));
      }, 10);
    }

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

      // Outline effect element found, functionality enabled
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
        if (obj.type === 'Mesh' && !this.isSnappingPointMesh(obj)) {
          // Exclude snap point meshes from outline rendering
          meshes.push(obj);
        } else if (obj.type === 'Group' || obj.userData.isSnappedGroup) {
          // Handle both regular Groups and snapped groups (which might be Object3D type)
          // Use pre-cached meshes if available for better performance
          if (obj.userData.meshes && Array.isArray(obj.userData.meshes)) {
            // Filter out any snap point meshes from cached meshes
            const filteredMeshes = obj.userData.meshes.filter(
              (mesh: Object3D) => !this.isSnappingPointMesh(mesh)
            );
            meshes.push(...filteredMeshes);
          } else {
            // Fallback: traverse and collect all mesh children (excluding snap points)
            obj.traverse((child) => {
              if (child.type === 'Mesh' && !this.isSnappingPointMesh(child)) {
                meshes.push(child);
              }
            });
          }
        }
      });

      return meshes;
    }

    /**
     * Check if a mesh is part of a snapping point visualization
     */
    private isSnappingPointMesh(mesh: Object3D): boolean {
      // Check if the mesh itself is named as a snapping point
      if (mesh.name === 'SnappingPointSphere') {
        return true;
      }

      // Check if the mesh is a child of a snapping point group
      let parent = mesh.parent;
      while (parent) {
        if (parent.name === 'SnappingPointSphere') {
          return true;
        }
        parent = parent.parent;
      }

      return false;
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

    private removeObject3D(object3D) {
      if (!(object3D instanceof Object3D)) return false;

      // for better memory management and performance
      if (object3D.geometry) object3D.geometry.dispose();

      if (object3D.material) {
        if (object3D.material instanceof Array) {
          // for better memory management and performance
          object3D.material.forEach((material) => material.dispose());
        } else {
          // for better memory management and performance
          object3D.material.dispose();
        }
      }
      object3D.removeFromParent(); // the parent might be the scene or another Object3D, but it is sure to be removed this way
      return true;
    }

    private deleteObject(object: Object3D) {
      try {
        // Clear selection
        this.deselectObject();

        // If it's a GLB, remove it from the addedGLBs set
        if (object.userData.isPlacedObject) {
          this.addedGLBs.delete(object);
        }

        // Remove the object from the scene
        this.removeObject3D(object);

        // Update shadows after deletion
        this[$scene].updateShadow();
        this[$needsRender]();
      } catch (e) {
        console.error('Error deleting object:', e);
      }
    }

    public deleteObjectByFileName(filename: string) {
      try {
        this[$scene].traverse((child) => {
          if (child.userData?.filename === filename) {
            this.deleteObject(child);
            throw new Error('Object deleted'); // Stop traversal after deletion
          }
        });
      } catch (e) {
        if ((e as Error).message !== 'Object deleted') {
          throw e; // Re-throw if it's not the expected error
        }
      }
    }

    public deleteSelected() {
      if (this.selectedObjects.length === 0) return;

      // Delete each selected object
      this.selectedObjects.forEach((object) => {
        this.deleteObject(object);
      });
    }

    async rotateSelected(deg) {
      if (this.selectedObjects.length === 0) return;
      const selectedObject = this.selectedObjects[0];

      this.rotateObject(MathUtils.degToRad(deg), selectedObject);
    }

    async placeGLB(src: string, options: PlacementOptions = {}): Promise<void> {
      this.deselectObject();
      const loader = new GLTFLoader();

      const targetObject = this.findTargetObject();

      const visualizationBox = this.createVisualizationBox(
        { x: 1, y: 1, z: 1 },
        options.position ?? { x: 0, y: 0, z: 0 }
      );
      targetObject.add(visualizationBox);

      return new Promise((resolve, reject) => {
        loader.load(
          src,
          (gltf) => {
            const objectName =
              options.name ||
              `part__${Math.random().toString(36).substring(2, 9)}`;
            gltf.scene.name = 'part__' + objectName;
            gltf.scene.userData['filepath'] = src;
            gltf.scene.userData['name'] = objectName;

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
            if (options.snappingPoints && options.snappingPoints.length > 0) {
              // Use provided snap points
              gltf.scene.userData.snappingPoints = options.snappingPoints;
            } else {
              // Generate default snap points if none provided
              // We'll generate them after the object is positioned and added to the scene
              gltf.scene.userData.needsDefaultSnappingPoints = true;
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
                  if (gltf.scene.userData.needsDefaultSnappingPoints) {
                    gltf.scene.userData.snappingPoints =
                      generateDefaultSnappingPoints(gltf.scene);
                    delete gltf.scene.userData.needsDefaultSnappingPoints;
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
            if (xhr.loaded === xhr.total) {
              // Fade out and remove the visualization box when animation completes
              const visualizationBox = targetObject.children.find(
                (child) => child.name === 'VisualizationBox'
              );
              if (visualizationBox && visualizationBox instanceof Mesh) {
                this.fadeOutVisualizationBox(visualizationBox, 300, () => {
                  targetObject.remove(visualizationBox);
                });
              }
            }
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

    private hideCustomSnappingPointSlots() {
      // Find all custom snapping-point slots in the light DOM and hide them by default
      const customSlots = this.querySelectorAll('[slot="snapping-point"]');
      customSlots.forEach((slot) => {
        const element = slot as HTMLElement;
        // Store original visibility and hide the element
        element.dataset.originalDisplay = element.style.display || '';
        element.style.visibility = 'hidden';
        element.style.position = 'absolute';
        element.style.left = '-9999px';
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

      // Dragging started for selected objects
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
        // Calculate the desired position with drag offset
        const desiredX = intersectionPoint.x + this.dragOffset.x;
        const desiredZ = intersectionPoint.z + this.dragOffset.z;

        // For groups, preserve the current Y position to maintain internal object relationships
        // For individual objects, use floor positioning
        const desiredY = object.userData.isSnappedGroup
          ? object.position.y // Preserve current Y for groups
          : this.originalFloorY || 0; // Use floor Y for individual objects

        // Set the position (might be overridden by snapping)
        object.position.set(desiredX, desiredY, desiredZ);

        // Check for snapping if enabled
        this.pendingSnapConnection = null;
        if (this.snappingEnabled) {
          this.checkAndApplySnapping(object, intersectionPoint);
        }

        this[$scene].updateShadow();

        this[$needsRender]();
      }
    }

    private checkAndApplySnapping(
      draggedObject: Object3D,
      intersectionPoint: Vector3
    ) {
      // Find snappable objects within the dragged object (could be a group or single object)
      const snappableObjects: Object3D[] = [];
      if (draggedObject.userData.isSnappedGroup) {
        // If it's a group, check all child objects for snapping
        draggedObject.traverse((child) => {
          if (child.userData.isPlacedObject && child.userData.snappingPoints) {
            snappableObjects.push(child);
          }
        });
      } else if (draggedObject.userData.snappingPoints) {
        // Single object
        snappableObjects.push(draggedObject);
      }

      if (snappableObjects.length === 0) return;

      const targetObject = this.findTargetObject();
      if (!targetObject) return;

      let bestConnection: {
        draggedObject: Object3D;
        targetObject: Object3D;
        draggedPoint: SnappingPoint;
        targetPoint: SnappingPoint;
        distance: number;
      } | null = null;

      // Check snapping from any snappable object to any target
      snappableObjects.forEach((snappableObj) => {
        targetObject.traverse((child) => {
          if (
            child.userData.isPlacedObject &&
            child !== snappableObj &&
            !this.areObjectsInSameGroup(snappableObj, child) &&
            child.userData.snappingPoints
          ) {
            const connections = findSnappingConnections(snappableObj, child);
            if (connections.length > 0) {
              const closest = connections[0];
              if (
                !bestConnection ||
                closest.distance < bestConnection.distance
              ) {
                bestConnection = {
                  draggedObject: snappableObj,
                  targetObject: child,
                  draggedPoint: closest.draggedPoint,
                  targetPoint: closest.targetPoint,
                  distance: closest.distance,
                };
              }
            }
          }
        });
      });

      if (bestConnection) {
        // Calculate the offset needed to align the snap points
        const draggedWorldPos = getSnappingPointWorldPosition(
          bestConnection.draggedObject,
          bestConnection.draggedPoint
        );
        const targetWorldPos = getSnappingPointWorldPosition(
          bestConnection.targetObject,
          bestConnection.targetPoint
        );

        // Move the entire dragged object/group so the snap points align
        const offset = targetWorldPos.sub(draggedWorldPos);
        draggedObject.position.add(offset);

        // Store the pending connection for completion on drag end
        this.pendingSnapConnection = {
          draggedObject: bestConnection.draggedObject,
          targetObject: bestConnection.targetObject,
          draggedPoint: bestConnection.draggedPoint,
          targetPoint: bestConnection.targetPoint,
        };

        // Objects snapped together
      }
    }

    private areObjectsInSameGroup(obj1: Object3D, obj2: Object3D): boolean {
      const group1 = getSnappedGroup(obj1);
      const group2 = getSnappedGroup(obj2);
      return group1 !== null && group1 === group2;
    }

    private stopDragging() {
      if (!this.isDragging) return;

      this.isDragging = false;

      // Complete any pending snap connection
      if (this.pendingSnapConnection) {
        this.completeSnapConnection(this.pendingSnapConnection);
        this.pendingSnapConnection = null;
      }

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

    private completeSnapConnection(connection: {
      draggedObject: Object3D;
      targetObject: Object3D;
      draggedPoint: SnappingPoint;
      targetPoint: SnappingPoint;
    }) {
      // Get the groups these objects belong to (if any)
      const draggedGroup = getSnappedGroup(connection.draggedObject);
      const targetGroup = getSnappedGroup(connection.targetObject);

      // Determine what objects we're actually connecting
      const objectToConnect1 = draggedGroup || connection.draggedObject;
      const objectToConnect2 = targetGroup || connection.targetObject;

      // If both objects are already in groups, we need to merge the groups
      if (draggedGroup && targetGroup) {
        this.mergeSnappedGroups(draggedGroup, targetGroup, connection);
      } else if (draggedGroup && !targetGroup) {
        // Add target object to existing dragged group
        this.addObjectToSnappedGroup(
          draggedGroup,
          connection.targetObject,
          connection
        );
      } else if (!draggedGroup && targetGroup) {
        // Add dragged object to existing target group
        this.addObjectToSnappedGroup(
          targetGroup,
          connection.draggedObject,
          connection
        );
      } else {
        // Create a new group from two individual objects
        const snappedGroup = createSnappedGroup(
          connection.draggedObject,
          connection.targetObject,
          connection.draggedPoint,
          connection.targetPoint
        );
        this.selectedObjects = [snappedGroup];
      }

      // Update outline selection
      this.updateOutlineSelection();

      // Refresh snap points since the objects are now grouped
      const targetObject = this.findTargetObject();
      if (targetObject) {
        // Use slot-based rendering instead of Three.js meshes
        this.setSnappingPointSlotsVisible(false);
        this.setSnappingPointSlotsVisible(true);
      }

      // Show break link slots since we now have a grouped object selected
      if (
        this.selectedObjects.length > 0 &&
        this.selectedObjects[0].userData.isSnappedGroup
      ) {
        this.setBreakLinkSlotsVisible(true);
      }

      // Force a render to show the new group state
      this[$needsRender]();

      // Snap connection completed
    }

    private mergeSnappedGroups(
      group1: Object3D,
      group2: Object3D,
      connection: {
        draggedObject: Object3D;
        targetObject: Object3D;
        draggedPoint: SnappingPoint;
        targetPoint: SnappingPoint;
      }
    ) {
      // Move all objects from group2 into group1, preserving world positions
      const objectsToMove = [...group2.children];
      objectsToMove.forEach((obj) => {
        // Save world position before moving
        const worldPosition = new Vector3();
        const worldQuaternion = new Quaternion();
        const worldScale = new Vector3();
        obj.getWorldPosition(worldPosition);
        obj.getWorldQuaternion(worldQuaternion);
        obj.getWorldScale(worldScale);

        group2.remove(obj);
        group1.add(obj);

        // Convert world position to group1's local coordinate system
        group1.worldToLocal(worldPosition);
        obj.position.copy(worldPosition);
        obj.quaternion.copy(worldQuaternion);
        obj.scale.copy(worldScale);
      });

      // Add the connection to group1's snap connections
      if (!group1.userData.snapConnections) {
        group1.userData.snapConnections = [];
      }
      group1.userData.snapConnections.push({
        object1: connection.draggedObject,
        object2: connection.targetObject,
        snapPoint1: { ...connection.draggedPoint },
        snapPoint2: { ...connection.targetPoint },
      });

      // Copy over any existing connections from group2
      if (group2.userData.snapConnections) {
        group1.userData.snapConnections.push(
          ...group2.userData.snapConnections
        );
      }

      // Mark the snap points as used
      connection.draggedPoint.isUsed = true;
      connection.targetPoint.isUsed = true;

      // Remove group2 from its parent
      if (group2.parent) {
        group2.parent.remove(group2);
      }

      // Update the mesh cache for group1 after merging
      this.updateGroupMeshCache(group1);

      // Update selection to group1
      this.selectedObjects = [group1];
    }

    private addObjectToSnappedGroup(
      group: Object3D,
      newObject: Object3D,
      connection: {
        draggedObject: Object3D;
        targetObject: Object3D;
        draggedPoint: SnappingPoint;
        targetPoint: SnappingPoint;
      }
    ) {
      // Save the world position before removing from current parent
      const worldPosition = new Vector3();
      const worldQuaternion = new Quaternion();
      const worldScale = new Vector3();
      newObject.getWorldPosition(worldPosition);
      newObject.getWorldQuaternion(worldQuaternion);
      newObject.getWorldScale(worldScale);

      // Remove the new object from its current parent and add to group
      if (newObject.parent) {
        newObject.parent.remove(newObject);
      }
      group.add(newObject);

      // Convert world position to group's local coordinate system
      group.worldToLocal(worldPosition);
      newObject.position.copy(worldPosition);
      newObject.quaternion.copy(worldQuaternion);
      newObject.scale.copy(worldScale);

      // Add the connection to the group's snap connections
      if (!group.userData.snapConnections) {
        group.userData.snapConnections = [];
      }
      group.userData.snapConnections.push({
        object1: connection.draggedObject,
        object2: connection.targetObject,
        snapPoint1: { ...connection.draggedPoint },
        snapPoint2: { ...connection.targetPoint },
      });

      // Mark the snap points as used
      connection.draggedPoint.isUsed = true;
      connection.targetPoint.isUsed = true;

      // Update the mesh cache for the group after adding new object
      this.updateGroupMeshCache(group);

      // Update selection to the group
      this.selectedObjects = [group];
    }
    /**
     * Update the mesh cache for a group after its structure has changed
     */
    private updateGroupMeshCache(group: Object3D) {
      if (!group.userData.isSnappedGroup) return;

      group.userData.meshes = [];
      group.traverse((child) => {
        if (child.type === 'Mesh' && !this.isSnappingPointMesh(child)) {
          group.userData.meshes.push(child);
        }
      });

      // Mesh cache updated for group
    }

    private handleSelection(event?: MouseEvent | TouchEvent) {
      const selectedPart = this.getPartObjectAtPosition(
        this.currentMousePosition
      );

      if (selectedPart) {
        // Check if the object is part of a snapped group
        const snappedGroup = getSnappedGroup(selectedPart);
        const objectToSelect = snappedGroup || selectedPart;

        // Toggle selection if clicking the same object/group, otherwise select new object/group
        if (
          this.selectedObjects.length === 1 &&
          this.selectedObjects[0] === objectToSelect
        ) {
          this.deselectObject();
        } else {
          this.selectObject(objectToSelect);
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
      const targetObject = this.findTargetObject();
      if (targetObject) {
        // Use slot-based rendering instead of Three.js meshes
        this.setSnappingPointSlotsVisible(true);
      }

      // Show break link slots if a grouped object is selected
      if (
        this.selectedObjects.length > 0 &&
        this.selectedObjects[0].userData.isSnappedGroup
      ) {
        this.setBreakLinkSlotsVisible(true);
      }

      // Disable camera panning while a part is selected
      if (this[$controls]) {
        this[$controls].enablePan = false;
      }

      this[$selectObjectForControls](object);

      // Force a render to ensure proper orientation
      this[$needsRender]();

      // Slot-based snapping points update automatically in the tick method
    }

    private deselectObject() {
      if (this.selectedObjects.length > 0) {
        this.selectedObjects = [];
        this.selectedGroups.clear(); // Clear group tracking

        // Update outline selection
        this.updateOutlineSelection();

        // Hide snap points when no object is selected
        const targetObject = this.findTargetObject();
        if (targetObject) {
          // Use slot-based rendering instead of Three.js meshes
          this.setSnappingPointSlotsVisible(false);
        }

        // Stop any active rotation animation
        if (this.isAnimatingRotation) {
          this.isAnimatingRotation = false;
          this.rotationAnimation = null;
        }

        // Hide break link slots when no object is selected
        this.setBreakLinkSlotsVisible(false);

        this[$selectObjectForControls](null);

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

      // Hide any existing custom snapping-point slots by default
      this.hideCustomSnappingPointSlots();

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

      // Clean up any active rotation animation
      if (this.isAnimatingRotation) {
        this.isAnimatingRotation = false;
        this.rotationAnimation = null;
      }

      // Clean up snap points
      const targetObject = this.findTargetObject();
      if (targetObject) {
        // Clean up slot-based rendering
        this.clearSlots(this.snappingPointSlots);
        this.clearSlots(this.breakLinkSlots);
      }

      if (this.cursor) {
        this.cursor.cleanup();
      }
    }

    // Public API for snapping control
    public setSnappingEnabled(enabled: boolean) {
      this.snappingEnabled = enabled;
    }

    public getSnappingEnabled(): boolean {
      return this.snappingEnabled;
    }

    // Future ungroup functionality
    public ungroupSelectedObject(): boolean {
      if (this.selectedObjects.length !== 1) return false;

      const selectedObject = this.selectedObjects[0];
      if (!selectedObject.userData.isSnappedGroup) return false;

      return this.ungroupSnappedGroup(selectedObject);
    }

    private ungroupSnappedGroup(group: Object3D): boolean {
      if (!group.userData.snapConnections) return false;

      // No need to restore snap points since we don't mark them as used anymore
      // group.userData.snapConnections.forEach((connection: any) => {
      //   if (connection.snapPoint1) connection.snapPoint1.isUsed = false;
      //   if (connection.snapPoint2) connection.snapPoint2.isUsed = false;
      // });

      // Move all child objects back to the target object (where objects should live)
      const targetObject = this.findTargetObject();
      const childObjects = [...group.children];
      const ungroupedObjects: Object3D[] = [];

      childObjects.forEach((child) => {
        // Save the world position and rotation before removing from group
        const worldPosition = new Vector3();
        const worldQuaternion = new Quaternion();
        const worldScale = new Vector3();
        child.getWorldPosition(worldPosition);
        child.getWorldQuaternion(worldQuaternion);
        child.getWorldScale(worldScale);

        group.remove(child);
        if (targetObject) {
          targetObject.add(child);

          // Convert world position to local space of the target object
          targetObject.worldToLocal(worldPosition);
          child.position.copy(worldPosition);
          child.quaternion.copy(worldQuaternion);
          child.scale.copy(worldScale);

          // Ensure the child is marked as a placed object with snapping points
          child.userData.isPlacedObject = true;
          // Remove any group-related flags
          delete child.userData.isInGroup;

          // Ensure snapping points are preserved and restored if needed
          if (!child.userData.snappingPoints) {
            // If snapping points are missing, try to restore from defaults
            child.userData.snappingPoints =
              generateDefaultSnappingPoints(child);
          }

          ungroupedObjects.push(child);
        }
      });

      // Remove the group itself
      if (group.parent) {
        group.parent.remove(group);
      }

      // Select one of the ungrouped objects to show snapping points
      // This allows immediate re-snapping
      if (ungroupedObjects.length > 0) {
        this.selectObject(ungroupedObjects[0]);

        // Force an explicit update of snapping point slots after a brief delay
        // to ensure the ungrouped objects are properly processed
        setTimeout(() => {
          this.setSnappingPointSlotsVisible(true);
          this.updateSnappingPointSlots();
        }, 10);
      } else {
        // Fallback: clear selection
        this.deselectObject();
      }

      // Trigger render update
      this[$needsRender]();

      // Group successfully ungrouped
      return true;
    }

    /**
     * Create a visualization box that shows only the bottom face of the placement area.
     * The bottom face will be semi-transparent and positioned at the same location as the GLB.
     */
    private createVisualizationBox(
      size: {
        x: number;
        y: number;
        z: number;
      },
      position: { x: number; y: number; z: number }
    ): Mesh {
      // Create a plane geometry for just the bottom face with the same X and Z dimensions
      const bottomGeometry = new PlaneGeometry(size.x, size.z);

      // Create a semi-transparent material for the bottom face
      const bottomMaterial = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3, // Semi-transparent
        side: 2, // DoubleSide to ensure visibility from all angles
      });

      // Create the visualization box using only the bottom face
      const visualizationBox = new Mesh(bottomGeometry, bottomMaterial);
      visualizationBox.name = 'VisualizationBox';

      // Rotate the plane to be horizontal (bottom face)
      visualizationBox.rotation.x = -Math.PI / 2;

      // Position the bottom face at the correct location
      visualizationBox.position.set(position.x, 0, position.z);
      this.startVisualizationBoxPulse(visualizationBox);
      return visualizationBox;
    }
    /**
     * Fade out a visualization box smoothly over time.
     */
    private fadeOutVisualizationBox(
      visualizationBox: Mesh,
      duration: number = 500,
      onComplete?: () => void
    ) {
      if (!(visualizationBox.material instanceof MeshBasicMaterial)) {
        onComplete?.();
        return;
      }

      const startOpacity = visualizationBox.material.opacity;
      const startTime = performance.now();

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Use ease-in function for smooth animation
        const easeIn = Math.pow(progress, 3);
        const currentOpacity = startOpacity * (1 - easeIn);

        visualizationBox.material.opacity = currentOpacity;
        this[$needsRender]();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          onComplete?.();
        }
      };

      requestAnimationFrame(animate);
    }

    /**
     * Start a slow pulsing animation for the visualization box.
     * Pulses the opacity and scale to create a breathing effect.
     */
    private startVisualizationBoxPulse(visualizationBox: Mesh) {
      if (!(visualizationBox.material instanceof MeshBasicMaterial)) {
        console.warn(
          'Visualization box material is not MeshBasicMaterial:',
          visualizationBox.material
        );
        return;
      }

      const startTime = performance.now();
      const pulseDuration = 2000; // 2 seconds for a complete pulse cycle
      const minOpacity = 0.2;
      const maxOpacity = 0.6;
      const minScale = 0.95;
      const maxScale = 1.05;

      // Store reference to material to prevent issues
      const material = visualizationBox.material;

      const animate = () => {
        // Check if the visualization box is still in the scene
        if (!visualizationBox.parent) {
          return; // Stop animation if box was removed
        }

        const elapsed = performance.now() - startTime;
        const progress = (elapsed % pulseDuration) / pulseDuration;
        const pulseValue = Math.sin(progress * Math.PI * 2) * 0.5 + 0.5;

        // Animate opacity
        const currentOpacity =
          minOpacity + (maxOpacity - minOpacity) * pulseValue;
        material.opacity = currentOpacity;

        // Force material to update
        material.needsUpdate = true;

        // Animate scale for more visible pulsing effect
        const currentScale = minScale + (maxScale - minScale) * pulseValue;
        visualizationBox.scale.setScalar(currentScale);

        this[$needsRender]();

        requestAnimationFrame(animate);
      };

      // Start the animation
      requestAnimationFrame(animate);
    }

    private updateAllSlots() {
      this.updateSnappingPointSlots();
      this.updateBreakLinkSlots();
    }

    /**
     * Handle rotation slot click events
     */
    private rotateObject(rad: number, object: Object3D) {
      if (!object || this.isAnimatingRotation) return;

      const currentRotation = object.rotation.y;
      let targetRotation: number;

      targetRotation = currentRotation + rad;

      console.log(
        `Rotating object ${object.name} from ${currentRotation} to ${targetRotation}`
      );

      // For groups, we need to handle rotation around the group's center
      if (object.userData.isSnappedGroup) {
        this.rotateGroupAroundCenter(
          object,
          currentRotation,
          targetRotation,
          direction
        );
      } else {
        // For individual objects, use the normal rotation animation
        this.startRotationAnimation(object, currentRotation, targetRotation);
      }
    }

    /**
     * Rotate a group around its center point
     */
    private rotateGroupAroundCenter(
      group: Object3D,
      startRotation: number,
      targetRotation: number,
      direction: string
    ) {
      // Calculate the group's bounding box to find its center
      const boundingBox = new Box3().setFromObject(group);
      const center = boundingBox.getCenter(new Vector3());

      // Convert center to the group's parent coordinate system
      const groupParent = group.parent;
      if (groupParent) {
        groupParent.worldToLocal(center);
      }

      // Store the original position
      const originalPosition = group.position.clone();

      // Start the rotation animation with center-based rotation
      this.isAnimatingRotation = true;
      this.rotationAnimation = {
        object: group,
        startRotation: startRotation,
        targetRotation: targetRotation,
        startTime: performance.now(),
        duration: 500,
        isGroup: true,
        groupCenter: center,
        originalPosition: originalPosition,
      };
    }

    /**
     * Start a smooth rotation animation
     */
    private startRotationAnimation(
      object: Object3D,
      startRotation: number,
      targetRotation: number
    ) {
      this.isAnimatingRotation = true;
      this.rotationAnimation = {
        object: object,
        startRotation: startRotation,
        targetRotation: targetRotation,
        startTime: performance.now(),
        duration: 500, // Animation duration in milliseconds
      };
    }

    /**
     * Update the rotation animation
     */
    private updateRotationAnimation(currentTime: number) {
      if (!this.isAnimatingRotation || !this.rotationAnimation) {
        return;
      }

      const { object, startRotation, targetRotation, startTime, duration } =
        this.rotationAnimation;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use ease-out cubic easing for smooth animation
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      // Interpolate between start and target rotation
      const currentRotation =
        startRotation + (targetRotation - startRotation) * easeProgress;

      // Handle group rotation around center vs individual object rotation
      if (
        this.rotationAnimation.isGroup &&
        this.rotationAnimation.groupCenter &&
        this.rotationAnimation.originalPosition
      ) {
        // For groups, rotate around the group's center
        const { groupCenter, originalPosition } = this.rotationAnimation;

        // Calculate the rotation difference from start
        const rotationDiff = currentRotation - startRotation;

        // Temporarily move the group so its center is at origin
        const tempPosition = originalPosition.clone().sub(groupCenter);

        // Apply rotation to the temporary position
        const rotatedPosition = tempPosition.clone();
        rotatedPosition.applyAxisAngle(new Vector3(0, 1, 0), rotationDiff);

        // Move back and set the new position and rotation
        object.position.copy(rotatedPosition.add(groupCenter));
        object.rotation.y = currentRotation;
      } else {
        // For individual objects, use direct rotation
        object.rotation.y = currentRotation;
      }

      // Update shadows during animation
      this.updateShadowsWithGLBs();

      // Force a render to show the rotation
      this[$needsRender]();

      // Check if animation is complete
      if (progress >= 1) {
        this.finishRotationAnimation();
      }
    }

    /**
     * Finish the rotation animation
     */
    private finishRotationAnimation() {
      if (!this.rotationAnimation) return;

      const { object, targetRotation } = this.rotationAnimation;

      // Ensure final rotation is exact
      object.rotation.y = targetRotation;

      // Clean up animation state
      this.isAnimatingRotation = false;
      this.rotationAnimation = null;

      // Final render and shadow update
      this.updateShadowsWithGLBs();
      this[$needsRender]();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      // Update rotation animation if active
      if (this.isAnimatingRotation) {
        this.updateRotationAnimation(time);
      }

      this.updateAllSlots();
    }

    /**
     * Generic helper to clear and remove slot elements from a given map.
     */
    private clearSlots(slotMap: Map<string, HTMLElement>) {
      slotMap.forEach((element) => {
        if (element.parentElement) {
          element.parentElement.removeChild(element);
        }
      });
      slotMap.clear();
    }
  }

  return LDPuzzlerModelViewerElement;
};
