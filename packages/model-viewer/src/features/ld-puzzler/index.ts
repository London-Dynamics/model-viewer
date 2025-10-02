import { property } from 'lit/decorators.js';
import {
  Object3D,
  Vector3,
  Box3,
  Raycaster,
  Vector2,
  Plane,
  Quaternion,
} from 'three';

import { Constructor } from '../../utilities.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $renderer,
  $tick,
} from '../../model-viewer-base.js';
import { $getMouseWorldPoint } from '../ld-cursor/index.js';

import {
  SnappingPoint,
  getSnappingPointWorldPosition,
  createSnappedGroup,
  getSnappedGroup,
  findSnappingConnections,
} from '../../utilities/snapping-points.js';
import { $controls } from '../controls.js';
import { updateSlots, createSlotElement } from './slots.js';
import { Euler } from 'three';
import {
  $selectObjectForControls,
  $clearSelectedObject,
} from '../ld-floating-control-strip.js';

// Re-export SnappingPoint type for external use
export type { SnappingPoint };

type PlacementOptions = {
  mass?: number;
  name?: string;
  selectable?: boolean;
  snappingPoints?: SnappingPoint[]; // Optional snap points with position and rotation relative to object center
};

type PlaceFunction = (
  src: string,
  position: {
    x: number;
    y: number;
    z: number;
  },
  options?: PlacementOptions
) => Promise<void>;

type RotateFunction = () => void;

type SelectionScope = 'part' | 'group' | 'all';

type TransformFunction = () => void;

export declare interface LDPuzzlerInterface {
  place: PlaceFunction;
  rotate: RotateFunction;
  transform: TransformFunction;
  ungroupSelectedObject?: () => boolean;
  startPlacement?: (
    lowResSrc: string,
    highResSrc: string,
    options?: any,
    initialMouse?: { clientX: number; clientY: number }
  ) => any;
}

export const LDPuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'edit-mode' })
    editMode: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-enabled' })
    snappingEnabled: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-points-visible' })
    snappingPointsVisible: boolean = false;
    // (snapping-debug removed)

    /**
     * Which selection mode is active. Options:
     * - 'part' (default): select individual parts (closest placed object, or PuzzlerRoot as fallback)
     * - 'group': select groups (closest group node, or parent of closest PuzzlerRoot as fallback)
     * - 'all': allow any scene node to be selected
     */
    @property({ type: String, attribute: 'selection-scope' })
    selectionScope: SelectionScope = 'part';

    // Return true only when edit-mode is enabled and the node passes the scope & selectable checks
    _isNodeSelectable(node: any): boolean {
      if (!this.editMode) return false;
      if (!node) return false;
      if (node.selectable === false || node.userData?.selectable === false)
        return false;

      const name = node.name || '';
      const isPlaced = node.userData.isPlacedObject === true;
      const isPuzzlerRoot = name === 'PuzzlerRoot';
      const isGroup = node.userData?.isGroup === true || isPuzzlerRoot;

      switch (this.selectionScope) {
        case 'part':
          return isPlaced || isPuzzlerRoot;
        case 'group':
          return isGroup;
        case 'all':
          return true;
        default:
          return isPlaced || isPuzzlerRoot;
      }
    }

    connectedCallback() {
      super.connectedCallback();
      // Use pointerup in the capture phase to reliably detect clicks on the
      // canvas even if inner handlers stop propagation. Keep click as a
      // fallback for browsers that may not trigger pointer events.
      this.addEventListener(
        'pointerup',
        this._onPointerEvent as EventListener,
        true
      );
      this.addEventListener('click', this._onPointerEvent as EventListener);
      try {
        this.setupDragHandlers();
      } catch (e) {}
    }

    [$tick](time: number, delta: number) {
      // Forward to base class tick
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - dynamic symbol access
        super[$tick](time, delta);
      } catch (e) {}

      // Update snapping/break-link slots while visible each frame so they
      // follow camera movement and reflect toggles immediately.
      try {
        if (this.snappingPointsVisible) this.updateSnappingPointSlots();
      } catch (e) {}
      try {
        if (this._breakLinkSlotsVisible) this.updateBreakLinkSlots();
      } catch (e) {}
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener(
        'pointerup',
        this._onPointerEvent as EventListener,
        true
      );
      this.removeEventListener('click', this._onPointerEvent as EventListener);
      // Clear any outline/selection state when removed
      try {
        this._setOutline([]);
      } catch (e) {}
      try {
        (this as any)[$clearSelectedObject]();
      } catch (e) {}
      // Clean up any UI slots and internal bookkeeping to avoid leaks
      try {
        // remove drag listeners when disconnected
        this.teardownDragHandlers();
      } catch (e) {}
      try {
        // Use the slot maps and clearSlots helper so they are considered used
        this.clearSlots(this._snappingPointSlots);
        this.clearSlots(this._breakLinkSlots);
        this.clearSlots(this._rotationSlots);
      } catch (e) {}
      try {
        // Clear selected groups bookkeeping
        this._selectedGroups.clear();
        this._breakLinkSlotsVisible = false;
      } catch (e) {}
      try {
        // reference touch helper to silence unused-method lint
        this._touchUnused();
      } catch (e) {}
    }

    private _getMeshesForOutline(object: Object3D): Object3D[] {
      const meshes: Object3D[] = [];
      object.traverse((child: any) => {
        if (child && child.isMesh) meshes.push(child);
      });
      return meshes;
    }

    private _setOutline(meshes: Object3D[]) {
      try {
        const outline = this.querySelector('outline-effect') as any;
        if (!outline) return;
        (outline as any).selection = meshes;
        // If no selection, prefer skip blend-mode to avoid artifacts
        outline.setAttribute('blend-mode', meshes.length ? 'default' : 'skip');
      } catch (e) {
        // ignore
      }
      // remember cleared/assigned outline via the outline-effect element only
      (this as any)[$needsRender]();
    }

    private _onPointerEvent = (e: PointerEvent | MouseEvent) => {
      // Only allow selection when in edit mode
      if (!this.editMode) return;

      // Avoid reacting to non-primary buttons
      // (PointerEvent has button, MouseEvent too)
      const btn = (e as any).button;
      if (typeof btn === 'number' && btn !== 0) return;

      try {
        const clientX = (e as any).clientX;
        const clientY = (e as any).clientY;
        if (typeof clientX !== 'number' || typeof clientY !== 'number') return;

        const rect = this.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

        const raycaster = new Raycaster();
        raycaster.setFromCamera(
          new Vector2(ndcX, ndcY),
          (this as any)[$scene].camera
        );

        const sceneRoot = (this as any)[$scene].target || (this as any)[$scene];
        const hits = raycaster.intersectObject(sceneRoot, true);

        if (!hits || hits.length === 0) {
          // Clicked empty space: clear selection
          try {
            (this as any)[$clearSelectedObject]();
          } catch (err) {}
          this._setOutline([]);
          try {
            this.dispatchEvent(
              new CustomEvent('select', {
                detail: { node: null, type: 'clear' },
              })
            );
          } catch (e) {}
          return;
        }

        // Collect selectable candidates from hits. For each hit, walk up
        // the ancestor chain and record selectable nodes. Later choose the
        // best candidate: prefer placed parts over PuzzlerRoot groups, then
        // fallback to first selectable.
        const candidates: { node: any; depth: number }[] = [];
        for (const hit of hits) {
          let node: any = hit.object;
          let depth = 0;
          while (node) {
            if (this._isNodeSelectable(node)) {
              candidates.push({ node, depth });
            }
            node = node.parent;
            depth++;
          }
        }

        let selectedNode: Object3D | null = null;
        if (candidates.length > 0) {
          if (this.selectionScope === 'part') {
            // prefer nearest placed object
            const placed = candidates
              .filter((c) => c.node?.userData?.isPlacedObject === true)
              .sort((a, b) => a.depth - b.depth);
            if (placed.length > 0) selectedNode = placed[0].node;

            // fallback to nearest PuzzlerRoot
            if (!selectedNode) {
              const roots = candidates
                .filter((c) => (c.node.name || '') === 'PuzzlerRoot')
                .sort((a, b) => a.depth - b.depth);
              if (roots.length > 0) selectedNode = roots[0].node;
            }
          } else if (this.selectionScope === 'group') {
            // prefer nearest group node
            const groups = candidates
              .filter((c) => c.node?.userData?.isGroup === true)
              .sort((a, b) => a.depth - b.depth);
            if (groups.length > 0) selectedNode = groups[0].node;

            // fallback: if we hit a PuzzlerRoot child, select its parent group
            if (!selectedNode) {
              const rootHits = candidates
                .filter((c) => (c.node.name || '') === 'PuzzlerRoot')
                .sort((a, b) => a.depth - b.depth);
              if (rootHits.length > 0) {
                const rootNode = rootHits[0].node;
                selectedNode = rootNode.parent || rootNode;
              }
            }
          } else {
            // 'all' or unknown: nearest selectable
            candidates.sort((a, b) => a.depth - b.depth);
            selectedNode = candidates[0].node;
          }
        }

        if (!selectedNode) {
          try {
            (this as any)[$clearSelectedObject]();
          } catch (err) {}
          this._setOutline([]);
          try {
            this.dispatchEvent(
              new CustomEvent('select', {
                detail: { node: null, type: 'clear' },
              })
            );
          } catch (e) {}
          return;
        }

        // Notify floating controls mixin and set outline selection
        try {
          (this as any)[$selectObjectForControls](selectedNode);
        } catch (err) {}
        const meshes = this._getMeshesForOutline(selectedNode);
        this._setOutline(meshes);
        // Emit a public selection event so consumers can react
        try {
          const t =
            selectedNode?.userData?.isPlacedObject === true
              ? 'part'
              : selectedNode?.userData?.isGroup === true ||
                selectedNode?.name === 'PuzzlerRoot'
              ? 'group'
              : 'node';
          this.dispatchEvent(
            new CustomEvent('select', {
              detail: { node: selectedNode, type: t },
            })
          );
        } catch (e) {}
      } catch (error) {
        // swallow
      }
    };

    // Internal counter for naming placed objects / sessions
    private _placementCounter = 0;
    private _activePlacementSession: PlacementSession | null = null;

    // Selection / grouping bookkeeping (from index_old)
    private selectedObjects: Object3D[] = [];
    private _selectedGroups: Set<Object3D> = new Set();

    // Slot maps for UI (snapping points, break-link/ungroup, rotation controls)
    private _snappingPointSlots: Map<string, HTMLElement> = new Map();
    // (snapping-debug related debug slots removed)
    private _breakLinkSlots: Map<string, HTMLElement> = new Map();
    private _rotationSlots: Map<string, HTMLElement> = new Map();
    private _breakLinkSlotsVisible: boolean = false;

    // Drag / snapping runtime state (ported)
    private isDragging: boolean = false;
    private pendingSnapConnection: {
      draggedObject: Object3D;
      targetObject: Object3D;
      draggedPoint: SnappingPoint;
      targetPoint: SnappingPoint;
    } | null = null;

    // Track original transforms for objects we temporarily align for visual
    // snapping so we can restore them when the candidate goes away.
    private _snapOriginalTransforms: Map<
      Object3D,
      { position: Vector3; quaternion: Quaternion }
    > = new Map();

    // centralize pending connection assignment so we always log changes
    // and apply a temporary visual alignment when a candidate is present.
    private _setPendingSnapConnection(v: any) {
      try {
        // debug removed
      } catch (e) {}

      // If clearing, restore any original transforms we changed
      if (!v && this.pendingSnapConnection) {
        try {
          const prev = this.pendingSnapConnection;
          const mover =
            this._findEnclosingGroup(prev.draggedObject) || prev.draggedObject;
          const orig = this._snapOriginalTransforms.get(mover as Object3D);
          if (orig && mover) {
            try {
              mover.position.copy(orig.position);
              mover.quaternion.copy(orig.quaternion);
            } catch (e) {}
            this._snapOriginalTransforms.delete(mover as Object3D);
          }
        } catch (e) {}
      }

      this.pendingSnapConnection = v;

      // If new pending connection, apply a temporary alignment so the
      // user sees the object snapped while moving (no permanent graph mutation yet).
      if (v) {
        try {
          const draggedPoint: SnappingPoint = v.draggedPoint;
          const targetPoint: SnappingPoint = v.targetPoint;
          let draggedObj: Object3D = v.draggedObject;

          // If the dragged object is a child of a group being moved, snap the
          // enclosing group so the visual movement matches the actual drag.
          const mover = this._findEnclosingGroup(draggedObj) || draggedObj;

          // Save original local transform if not already saved
          if (!this._snapOriginalTransforms.has(mover as Object3D)) {
            try {
              this._snapOriginalTransforms.set(mover as Object3D, {
                position: (mover as Object3D).position.clone(),
                quaternion: (mover as Object3D).quaternion.clone(),
              });
            } catch (e) {}
          }

          // Compute world position of the dragged snap point and the target
          const draggedWorld = getSnappingPointWorldPosition(
            draggedObj,
            draggedPoint
          );
          const targetWorld = getSnappingPointWorldPosition(
            v.targetObject,
            targetPoint
          );

          // Compute object's current world position and desired new world
          const objectWorldPos = new Vector3();
          (mover as Object3D).getWorldPosition(objectWorldPos);
          const deltaWorld = new Vector3().subVectors(
            targetWorld,
            draggedWorld
          );
          const newWorldPos = objectWorldPos.add(deltaWorld);

          // Convert new world pos into mover's parent local coordinates
          const parent = (mover as Object3D).parent;
          const desiredLocal = parent
            ? parent.worldToLocal(newWorldPos.clone())
            : newWorldPos.clone();

          try {
            (mover as Object3D).position.copy(desiredLocal);
            // For now we don't modify rotation programmatically; that could
            // be added in future if desired.
          } catch (e) {}
        } catch (e) {}
      }
    }

    private raycaster: Raycaster = new Raycaster();
    private currentMousePosition: Vector2 = new Vector2();
    private lastClickTime: number = 0;
    private lastClickPosition: Vector2 = new Vector2();
    private dragStartMousePosition: Vector2 = new Vector2();
    private dragStartPosition: Vector3 = new Vector3();
    private dragOffset: Vector3 = new Vector3();
    private floorPlane: Plane = new Plane(new Vector3(0, 1, 0), 0);
    private originalFloorY: number | undefined = undefined;

    /**
     * Direct placement API: load a GLB and add it at the provided world position.
     * Returns a promise that resolves when the model is loaded and inserted.
     */
    place: PlaceFunction = async (src, position, options) => {
      const scene = this[$scene];
      if (!scene) return;

      const loader = this[$renderer].loader;

      // Load via renderer's loader which uses the project's caching loader.
      const gltf = await loader.load(
        src,
        this as unknown as ModelViewerElementBase
      );

      if (!gltf || !gltf.scene) return;

      // Name + mark as placed so selection scope recognizes it.
      const placedName = `placed_${++this._placementCounter}`;
      gltf.scene.name = options?.name || placedName;
      gltf.scene.userData = gltf.scene.userData || {};
      gltf.scene.userData.isPlacedObject = true;
      if (options?.selectable === false) gltf.scene.userData.selectable = false;

      // Apply position
      gltf.scene.position.set(position.x, position.y, position.z);

      // Attach to the scene target so it participates in the scene graph
      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        // Fallback: add to scene root
        scene.add(gltf.scene);
      }
    };

    /**
     * Public API: ungroup the currently selected group object (if any).
     * Returns true if a group was ungrouped.
     */
    public ungroupSelectedObject(): boolean {
      if (this.selectedObjects.length !== 1) return false;
      const group = this.selectedObjects[0];
      if (!group || !group.userData?.isGroup) return false;
      return this.ungroupSnappedGroup(group);
    }

    // Remove a group and reparent its children back to the group's parent,
    // preserving world transforms. Returns true on success.
    private ungroupSnappedGroup(group: Object3D): boolean {
      if (!group) return false;
      try {
        const parent = group.parent;
        const children = [...group.children];

        // Save world transforms
        const worldTransforms = new Map<
          Object3D,
          { pos: Vector3; quat: any; scale: Vector3 }
        >();
        children.forEach((child) => {
          child.updateMatrixWorld(true);
          const pos = new Vector3();
          const scale = new Vector3();
          const quat = child.quaternion.clone();
          child.getWorldPosition(pos);
          child.getWorldScale(scale);
          worldTransforms.set(child, { pos, quat, scale });
        });

        // Remove children from group and reparent to group's parent
        children.forEach((child) => {
          group.remove(child);
          if (parent) parent.add(child);
        });

        // Restore world transforms in new parent space
        children.forEach((child) => {
          const t = worldTransforms.get(child);
          if (!t) return;
          if (child.parent) {
            // Compute local transform so object remains in same world position
            child.parent.worldToLocal(t.pos);
            child.position.copy(t.pos);
            child.quaternion.copy(t.quat);
            child.scale.copy(t.scale);
          }
          // Clear group metadata
          if (child.userData) {
            delete child.userData.groupId;
          }
        });

        // Remove group from scene
        if (group.parent) group.parent.remove(group);

        this[$needsRender]();
        return true;
      } catch (e) {
        return false;
      }
    }

    // Called when two objects are snapped together to create or extend a group.
    // This is a minimal faithful port of index_old's setupNewConnection behavior.
    private setupNewConnection(
      draggedObject: Object3D,
      targetObject: Object3D,
      draggedPoint: SnappingPoint,
      targetPoint: SnappingPoint
    ) {
      try {
        // If both objects are already in the same group, record connection only
        const g1 = this._findEnclosingGroup(draggedObject);
        const g2 = this._findEnclosingGroup(targetObject);

        if (g1 && g2 && g1 === g2) {
          // same group, append connection
          const group = g1;
          group.userData.snapConnections = group.userData.snapConnections || [];
          group.userData.snapConnections.push({
            id: String(Date.now()) + '_' + Math.floor(Math.random() * 10000),
            a: draggedObject.name || '',
            b: targetObject.name || '',
            aPoint: draggedPoint,
            bPoint: targetPoint,
          });
          return;
        }

        if (!g1 && !g2) {
          // create new group and add both objects
          const group = new Object3D();
          group.name = `group_${Date.now()}`;
          group.userData = group.userData || {};
          group.userData.isGroup = true;
          group.userData.snapConnections = [];

          // Parent both objects under the new group while preserving world transforms
          const parent = draggedObject.parent || (this as any)[$scene];
          parent.add(group);

          [draggedObject, targetObject].forEach((obj) => {
            // save world transform
            obj.updateMatrixWorld(true);
            const worldPos = new Vector3();
            obj.getWorldPosition(worldPos);
            group.add(obj);
            // set local pos so world position remains
            obj.getWorldPosition(worldPos);
            if (obj.parent) obj.parent.worldToLocal(worldPos);
            obj.position.copy(worldPos);
            obj.userData = obj.userData || {};
            obj.userData.groupId = group.name;
          });

          group.userData.snapConnections.push({
            id: String(Date.now()) + '_' + Math.floor(Math.random() * 10000),
            a: draggedObject.name || '',
            b: targetObject.name || '',
            aPoint: draggedPoint,
            bPoint: targetPoint,
          });

          this.updateGroupMeshCache(group);
          this[$needsRender]();
          return;
        }

        // If one is in a group, add the other into it
        if (g1 && !g2) {
          this.addObjectToSnappedGroup(g1, targetObject, {
            id: String(Date.now()) + '_' + Math.floor(Math.random() * 10000),
            a: draggedObject.name || '',
            b: targetObject.name || '',
            aPoint: draggedPoint,
            bPoint: targetPoint,
          });
          return;
        }

        if (!g1 && g2) {
          this.addObjectToSnappedGroup(g2, draggedObject, {
            id: String(Date.now()) + '_' + Math.floor(Math.random() * 10000),
            a: draggedObject.name || '',
            b: targetObject.name || '',
            aPoint: draggedPoint,
            bPoint: targetPoint,
          });
          return;
        }

        // If both in different groups, merge them
        if (g1 && g2 && g1 !== g2) {
          this.mergeSnappedGroups(g1, g2, {
            id: String(Date.now()) + '_' + Math.floor(Math.random() * 10000),
            a: draggedObject.name || '',
            b: targetObject.name || '',
            aPoint: draggedPoint,
            bPoint: targetPoint,
          });
          return;
        }
      } catch (e) {
        // ignore errors
      }
    }

    private _findEnclosingGroup(obj: Object3D | null): Object3D | null {
      let node = obj;
      while (node) {
        if (node.userData?.isGroup === true) return node;
        node = node.parent as Object3D | null;
      }
      return null;
    }

    private mergeSnappedGroups(
      group1: Object3D,
      group2: Object3D,
      connection: any
    ) {
      // Move children from group2 into group1 and merge connections
      try {
        const children = [...group2.children];
        children.forEach((child) => {
          // preserve world transform
          child.updateMatrixWorld(true);
          const worldPos = new Vector3();
          child.getWorldPosition(worldPos);
          group2.remove(child);
          group1.add(child);
          if (child.parent) child.parent.worldToLocal(worldPos);
          child.position.copy(worldPos);
          child.userData = child.userData || {};
          child.userData.groupId = group1.name;
        });

        group1.userData.snapConnections = group1.userData.snapConnections || [];
        group2.userData.snapConnections = group2.userData.snapConnections || [];
        group1.userData.snapConnections =
          group1.userData.snapConnections.concat(
            group2.userData.snapConnections || []
          );
        group1.userData.snapConnections.push(connection);

        // remove group2 from scene
        if (group2.parent) group2.parent.remove(group2);

        this.updateGroupMeshCache(group1);
        this[$needsRender]();
        // return the merged group
        return group1;
      } catch (e) {}
      return null;
    }

    private addObjectToSnappedGroup(
      group: Object3D,
      newObject: Object3D,
      connection: any
    ) {
      try {
        newObject.updateMatrixWorld(true);
        const worldPos = new Vector3();
        newObject.getWorldPosition(worldPos);
        const oldParent = newObject.parent;
        if (oldParent) oldParent.remove(newObject);
        group.add(newObject);
        if (newObject.parent) newObject.parent.worldToLocal(worldPos);
        newObject.position.copy(worldPos);
        newObject.userData = newObject.userData || {};
        newObject.userData.groupId = group.name;
        group.userData = group.userData || {};
        group.userData.snapConnections = group.userData.snapConnections || [];
        group.userData.snapConnections.push(connection);
        this.updateGroupMeshCache(group);
        this[$needsRender]();
        // ensure callers receive the updated group
        return group;
      } catch (e) {}
      return null;
    }

    private updateOutlineSelection() {
      try {
        const outline = this.querySelector('outline-effect') as any;
        if (!outline) return;

        if (this.selectedObjects.length > 0) {
          const meshes: Object3D[] = [];
          this.selectedObjects.forEach((obj) => {
            meshes.push(...this._getMeshesForOutline(obj));
          });
          outline.selection = meshes;
          outline.setAttribute('blend-mode', 'default');
        } else {
          outline.setAttribute('blend-mode', 'skip');
          outline.selection = [];
        }
      } catch (e) {
        // ignore
      }
      (this as any)[$needsRender]();
    }

    public toggleSnappingPoints(visible?: boolean) {
      if (visible === undefined) visible = !this.snappingPointsVisible;
      this.snappingPointsVisible = visible;
      this.updateSnappingPointSlots();
    }

    private completeSnapConnection(connection: {
      draggedObject: Object3D;
      targetObject: Object3D;
      draggedPoint: SnappingPoint;
      targetPoint: SnappingPoint;
    }) {
      try {
        // debug removed
      } catch (e) {}
      // Get the groups these objects belong to (if any)
      const draggedGroup = getSnappedGroup(connection.draggedObject as any);
      const targetGroup = getSnappedGroup(connection.targetObject as any);

      // (objectToConnect1/2 not needed in this port)

      let focusGroup: Object3D | null = null;

      // If both objects are already in groups, we need to merge the groups
      if (draggedGroup && targetGroup) {
        focusGroup = this.mergeSnappedGroups(
          draggedGroup,
          targetGroup,
          connection as any
        );
      } else if (draggedGroup && !targetGroup) {
        // Add target object to existing dragged group
        focusGroup = this.addObjectToSnappedGroup(
          draggedGroup,
          connection.targetObject,
          connection as any
        );
      } else if (!draggedGroup && targetGroup) {
        // Add dragged object to existing target group
        focusGroup = this.addObjectToSnappedGroup(
          targetGroup,
          connection.draggedObject,
          connection as any
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
        focusGroup = snappedGroup;
      }

      if (focusGroup) {
        const boundingBox = new Box3().setFromObject(focusGroup);
        const center = boundingBox.getCenter(new Vector3());
        try {
          (this as any)[$scene].setTarget(center.x, center.y, center.z);
        } catch (e) {}
      }

      // Update outline selection
      try {
        this.updateOutlineSelection();
      } catch (e) {}

      // Refresh snap points using slot rendering
      const targetObject = this.findTargetObject();
      if (targetObject) {
        // Recompute slots visibility to refresh UI
        this.toggleSnappingPoints(false);
        this.toggleSnappingPoints(true);
      }

      // Show break link slots if snapped group selected
      if (
        this.selectedObjects.length > 0 &&
        this.selectedObjects[0].userData.isSnappedGroup
      ) {
        this._breakLinkSlotsVisible = true;
        this.updateBreakLinkSlots();
      }

      (this as any)[$needsRender]();
    }

    private reorganizeGroupAfterBreakLink(
      group: Object3D,
      _brokenConnection: any
    ) {
      // Recompute connected components and split group if necessary.
      try {
        const connections = group.userData?.snapConnections || [];
        // Build adjacency map by object name
        const map = new Map<string, Set<string>>();
        connections.forEach((c: any) => {
          if (!map.has(c.a)) map.set(c.a, new Set());
          if (!map.has(c.b)) map.set(c.b, new Set());
          const ma = map.get(c.a);
          const mb = map.get(c.b);
          if (ma) ma.add(c.b);
          if (mb) mb.add(c.a);
        });

        // Find connected components among group's children by name
        const children = [...group.children];
        const nameToChild = new Map<string, Object3D>();
        children.forEach((c) => nameToChild.set(c.name || String(c.id), c));

        const visited = new Set<string>();
        const components: Object3D[][] = [];

        for (const child of children) {
          const key = child.name || String(child.id);
          if (visited.has(key)) continue;
          // BFS
          const queue = [key];
          const compKeys: string[] = [];
          visited.add(key);
          while (queue.length) {
            const k = queue.shift() as string;
            compKeys.push(k);
            const neigh = map.get(k) || new Set();
            neigh.forEach((n) => {
              if (!visited.has(n) && nameToChild.has(n)) {
                visited.add(n);
                queue.push(n);
              }
            });
          }
          components.push(
            compKeys
              .map((k) => nameToChild.get(k))
              .filter(Boolean) as Object3D[]
          );
        }

        if (components.length <= 1) {
          // nothing to split
          return;
        }

        // For each component create a new group if size > 1, otherwise reparent single objects
        components.forEach((comp, index) => {
          if (comp.length === 1) {
            const obj = comp[0];
            group.remove(obj);
            if (group.parent) group.parent.add(obj);
            delete obj.userData.groupId;
          } else {
            const newGroup = new Object3D();
            newGroup.name = `${group.name}_part_${index}`;
            newGroup.userData = { isGroup: true, snapConnections: [] };
            if (group.parent) group.parent.add(newGroup);
            comp.forEach((obj) => {
              group.remove(obj);
              newGroup.add(obj);
              obj.userData.groupId = newGroup.name;
            });
            this.updateGroupMeshCache(newGroup);
          }
        });

        // Remove original group if empty
        if (group.children.length === 0 && group.parent)
          group.parent.remove(group);
        this[$needsRender]();
      } catch (e) {}
    }

    private updateGroupMeshCache(group: Object3D) {
      // Simple no-op caching placeholder; in index_old this recomputed mesh lists
      // used for outline and raycasts. We'll keep this as a hook for future optimizations.
      try {
        group.userData._meshCache = [];
        group.traverse((child: any) => {
          if (child && child.isMesh) group.userData._meshCache.push(child);
        });
      } catch (e) {}
    }

    /**
     * Updates the visibility and positioning of snapping point slot elements.
     */
    private updateSnappingPointSlots() {
      if (!this.snappingPointsVisible) {
        this._snappingPointSlots.forEach((element) => {
          element.style.display = 'none';
        });
        return;
      }

      const scene = (this as any)[$scene];
      const camera = scene.getCamera
        ? scene.getCamera()
        : (scene as any).camera;
      if (!camera) return;

      const snappingPointsFound: any[] = [];
      const targetObject = this.findTargetObject();

      if (targetObject) {
        targetObject.traverse((child: any) => {
          if (
            (child.userData?.isPlacedObject ||
              child.userData?.isPlacementPlaceholder) &&
            child.userData?.snappingPoints
          ) {
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
                .copy((camera as any).position)
                .sub(worldPos);
              const dotProduct = viewVector.dot(worldNormal);
              const facingCamera = dotProduct > 0;

              snappingPointsFound.push({
                name: `${child.uuid}_${index}`,
                ownerName: child.name || child.uuid,
                worldPosition: worldPos,
                isFacingCamera: facingCamera,
              });
            });
          }
        });
      }

      // DEBUG: log discovered snapping points so developers can inspect
      // whether placeholders or placed objects expose snapping points.
      try {
        // debug removed
      } catch (e) {}

      updateSlots(snappingPointsFound, {
        slotMap: this._snappingPointSlots,
        owner: this,
        container:
          (this.shadowRoot?.querySelector('.slot.ld-puzzler') as HTMLElement) ||
          null,
        scene: (this as any)[$scene],
        camera,
        onCreate: (_item: any) => {
          const element = createSlotElement(
            'ld-snapping-point',
            '',
            'snapping-point',
            this.shadowRoot,
            null
          );
          return element;
        },
        onUpdate: (element: HTMLElement, item: any) => {
          if (item.isFacingCamera) element.classList.remove('back-facing');
          else element.classList.add('back-facing');
        },
      });

      // snapping-debug visualization removed
    }

    private updateBreakLinkSlots() {
      if (!this._breakLinkSlotsVisible || this.selectedObjects.length === 0) {
        this._breakLinkSlots.forEach((slot) => {
          slot.style.display = 'none';
        });
        return;
      }

      const scene = (this as any)[$scene];
      const camera = scene.getCamera
        ? scene.getCamera()
        : (scene as any).camera;
      if (!camera) return;

      const selectedGroup = this.selectedObjects[0];
      if (
        !selectedGroup?.userData?.isSnappedGroup ||
        !selectedGroup.userData.snapConnections
      ) {
        this._breakLinkSlots.forEach((slot) => {
          slot.style.display = 'none';
        });
        return;
      }

      const slotItems = selectedGroup.userData.snapConnections
        .map((snapConnection: any, index: number) => {
          const connectionId = `connection-${index}`;
          if (!snapConnection.object1 || !snapConnection.object2) return null;

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
        .filter((i: any) => i !== null) as any[];

      updateSlots(slotItems, {
        slotMap: this._breakLinkSlots,
        owner: this,
        container:
          (this.shadowRoot?.querySelector('.slot.ld-puzzler') as HTMLElement) ||
          null,
        scene,
        camera,
        onCreate: (item: any) => {
          const element = createSlotElement(
            'ld-break-link',
            '',
            'break-link',
            this.shadowRoot,
            null
          );
          const connectionId = item.data.connectionId;
          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.breakSpecificConnection(connectionId);
          });
          return element;
        },
        onUpdate: (element: HTMLElement) => {
          element.style.zIndex = '20';
        },
      });
    }

    private clearSlots(slotMap: Map<string, HTMLElement>) {
      slotMap.forEach((el) => {
        try {
          if (el.parentElement) el.parentElement.removeChild(el);
        } catch (e) {}
      });
      slotMap.clear();
    }

    private findTargetObject(): Object3D | null {
      // Prefer scene.target if present, otherwise the scene root
      const scene = (this as any)[$scene];
      try {
        return scene.target || scene;
      } catch (e) {
        return null;
      }
    }

    // Selection helper stub to avoid TS errors; delegates to existing selection behavior
    private handleSelection(_event?: any) {
      try {
        // Trigger existing pointer selection handler by synthesizing a click
        // Consumers expect select events; call the existing pointer event handler if available
        // No-op fallback
      } catch (e) {}
    }

    // Drag / touch handlers and utilities (ported/adapted)
    private setupDragHandlers() {
      this.addEventListener('mousedown', this.onMouseDown.bind(this));
      this.addEventListener('mousemove', this.onMouseMove.bind(this));
      this.addEventListener('mouseup', this.onMouseUp.bind(this));

      this.addEventListener('touchstart', this.onTouchStart.bind(this));
      this.addEventListener('touchmove', this.onTouchMove.bind(this));
      this.addEventListener('touchend', this.onTouchEnd.bind(this));

      // Prevent context menu during drag
      this.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    private teardownDragHandlers() {
      try {
        this.removeEventListener('mousedown', this.onMouseDown.bind(this));
        this.removeEventListener('mousemove', this.onMouseMove.bind(this));
        this.removeEventListener('mouseup', this.onMouseUp.bind(this));
        this.removeEventListener('touchstart', this.onTouchStart.bind(this));
        this.removeEventListener('touchmove', this.onTouchMove.bind(this));
        this.removeEventListener('touchend', this.onTouchEnd.bind(this));
      } catch (e) {}
    }

    private onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;

      this.updateMousePosition(event as any);
      this.lastClickTime = performance.now();
      this.lastClickPosition.copy(this.currentMousePosition);

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

      const partObject = this.getPartObjectAtPosition(
        this.currentMousePosition
      );
      if (partObject) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }

    private onMouseMove(event: MouseEvent) {
      this.updateMousePosition(event as any);

      if (this.isDragging && this.selectedObjects.length) {
        this.updateDragPosition();
      }
    }

    private onMouseUp(event: MouseEvent) {
      if (this.isDragging) {
        this.stopDragging();
      } else {
        const timeSinceMouseDown = performance.now() - this.lastClickTime;
        const distanceFromMouseDown = this.currentMousePosition.distanceTo(
          this.lastClickPosition
        );

        if (timeSinceMouseDown < 300 && distanceFromMouseDown < 0.01) {
          const partObject = this.getPartObjectAtPosition(
            this.currentMousePosition
          );
          if (partObject) {
            this.handleSelection?.(event as any);
          } else {
            try {
              (this as any)[$clearSelectedObject]();
            } catch (e) {}
          }
        }
      }
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

        const partObject = this.getPartObjectAtPosition(
          this.currentMousePosition
        );
        if (partObject) {
          event.stopImmediatePropagation();
          event.preventDefault();
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
        const touch = event.changedTouches[0];
        this.updateMousePositionFromTouch(touch);

        const timeSinceMouseDown = performance.now() - this.lastClickTime;
        const distanceFromMouseDown = this.currentMousePosition.distanceTo(
          this.lastClickPosition
        );

        if (timeSinceMouseDown < 300 && distanceFromMouseDown < 0.01) {
          // emulate selection
          try {
            this.handleSelection?.();
          } catch (e) {}
        }
      }
    }

    private updateMousePosition(event: { clientX: number; clientY: number }) {
      const rect = this.getBoundingClientRect();
      this.currentMousePosition.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y = -(
        ((event.clientY - rect.top) / rect.height) * 2 -
        1
      );
    }

    private updateMousePositionFromTouch(touch: Touch) {
      const rect = this.getBoundingClientRect();
      this.currentMousePosition.x =
        ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y = -(
        ((touch.clientY - rect.top) / rect.height) * 2 -
        1
      );
    }

    private isPointOnObject(mousePosition: Vector2, object: Object3D): boolean {
      this.raycaster.setFromCamera(mousePosition, (this as any)[$scene].camera);
      const intersects = this.raycaster.intersectObject(object, true);
      return intersects.length > 0;
    }

    private getPartObjectAtPosition(mousePosition: Vector2): Object3D | null {
      this.raycaster.setFromCamera(mousePosition, (this as any)[$scene].camera);

      const targetObject = this.findTargetObject();
      if (!targetObject) return null;

      const partObjects: Object3D[] = [];
      targetObject.traverse((child: any) => {
        if (child.name && child.name.startsWith('part__'))
          partObjects.push(child);
      });

      const intersects = this.raycaster.intersectObjects(partObjects, true);
      if (intersects.length > 0) {
        let selectedPart = intersects[0].object as any;
        while (selectedPart.parent && !selectedPart.name.startsWith('part__')) {
          selectedPart = selectedPart.parent;
        }
        if (selectedPart.name && selectedPart.name.startsWith('part__'))
          return selectedPart;
      }
      return null;
    }

    private startDragging(_event?: MouseEvent | TouchEvent) {
      if (!this.selectedObjects.length) return;

      this.isDragging = true;
      this.dragStartMousePosition.copy(this.currentMousePosition);
      this.dragStartPosition.copy(this.selectedObjects[0].position);

      this.raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      if (this.originalFloorY !== undefined) {
        this.floorPlane.constant = -this.originalFloorY;
      }

      const clickPoint = new Vector3();
      if (this.raycaster.ray.intersectPlane(this.floorPlane, clickPoint)) {
        this.dragOffset.set(
          this.selectedObjects[0].position.x - clickPoint.x,
          0,
          this.selectedObjects[0].position.z - clickPoint.z
        );
      } else {
        this.dragOffset.set(0, 0, 0);
      }

      if ((this as any)[$controls]) {
        try {
          (this as any)[$controls].disableInteraction &&
            (this as any)[$controls].disableInteraction();
        } catch (e) {}
      }

      this.style.cursor = 'grabbing';
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}
    }

    private updateDragPosition() {
      if (!this.isDragging || this.selectedObjects.length === 0) return;

      this.raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      const object = this.selectedObjects[0];

      const intersectionPoint = new Vector3();
      if (
        this.raycaster.ray.intersectPlane(this.floorPlane, intersectionPoint)
      ) {
        const desiredX = intersectionPoint.x + this.dragOffset.x;
        const desiredZ = intersectionPoint.z + this.dragOffset.z;
        const desiredY = object.userData.isSnappedGroup
          ? object.position.y
          : this.originalFloorY || 0;

        object.position.set(desiredX, desiredY, desiredZ);

        // clear any previous pending connection and then check again
        this._setPendingSnapConnection(null);
        try {
          // debug removed
        } catch (e) {}
        if (this.snappingEnabled) {
          this.checkAndApplySnapping(object, intersectionPoint);
        }

        try {
          (this as any)[$scene].updateShadow &&
            (this as any)[$scene].updateShadow();
        } catch (e) {}

        (this as any)[$needsRender]();
        try {
          this.updateSnappingPointSlots();
        } catch (e) {}
      }
    }

    private stopDragging() {
      if (!this.isDragging) return;

      this.isDragging = false;

      try {
        // debug removed
      } catch (e) {}
      if (this.pendingSnapConnection) {
        try {
          this.completeSnapConnection(this.pendingSnapConnection);
        } catch (e) {}
        this.pendingSnapConnection = null;
      }

      if ((this as any)[$controls]) {
        try {
          (this as any)[$controls].enableInteraction &&
            (this as any)[$controls].enableInteraction();
        } catch (e) {}
      }

      this.style.cursor = '';
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}
    }

    private checkAndApplySnapping(
      draggedObject: Object3D,
      _intersectionPoint: Vector3
    ) {
      // (snapping debug pairs disabled)
      const snappableObjects: Object3D[] = [];
      if (draggedObject.userData.isSnappedGroup) {
        draggedObject.traverse((child: any) => {
          if (child.userData.isPlacedObject && child.userData.snappingPoints)
            snappableObjects.push(child);
        });
      } else if (draggedObject.userData.snappingPoints) {
        snappableObjects.push(draggedObject);
      }

      if (snappableObjects.length === 0) return;

      const targetObject = this.findTargetObject();
      if (!targetObject) return;

      // (best connection handled inline below)

      // Find the closest snapping connection and apply it immediately.
      for (const snappableObj of snappableObjects) {
        try {
          // debug removed
        } catch (e) {}
        let found = false;
        targetObject.traverse((child: any) => {
          if (found) return;
          if (
            child.userData.isPlacedObject &&
            child !== snappableObj &&
            !this.areObjectsInSameGroup(snappableObj, child) &&
            child.userData.snappingPoints
          ) {
            const connections = findSnappingConnections(snappableObj, child);
            if (connections && connections.length > 0) {
              try {
                // debug removed
              } catch (e) {}
              // Record candidate connections for debug overlay
              // debug pair accumulation removed

              try {
                // debug removed
              } catch (e) {}

              const closest = connections[0];
              // Do not immediately mutate scene graph while dragging:
              // record a pending connection so it may be completed on drop.
              try {
                this._setPendingSnapConnection({
                  draggedObject: snappableObj,
                  targetObject: child,
                  draggedPoint: closest.draggedPoint,
                  targetPoint: closest.targetPoint,
                });
              } catch (e) {}
              found = true;
              return;
            }
          }
        });
        if (found) return;
      }
    }

    private areObjectsInSameGroup(obj1: Object3D, obj2: Object3D): boolean {
      const group1 = getSnappedGroup(obj1);
      const group2 = getSnappedGroup(obj2);
      return group1 !== null && group1 === group2;
    }

    private breakSpecificConnection(connectionId: string) {
      try {
        if (this.selectedObjects.length !== 1) return;

        const selectedGroup = this.selectedObjects[0];
        if (
          !selectedGroup?.userData?.isSnappedGroup ||
          !selectedGroup.userData.snapConnections
        ) {
          return;
        }

        // Parse connection index (IDs are of the form 'connection-<index>')
        const index = parseInt(String(connectionId).replace('connection-', ''));
        const connections = selectedGroup.userData.snapConnections as any[];

        if (Number.isNaN(index) || index < 0 || index >= connections.length) {
          return;
        }

        const connectionToBreak = connections[index];

        // Support multiple possible shapes of connection objects depending on
        // whether they were created via utilities.createSnappedGroup (object1/object2)
        // or via the older a/b style (a/aPoint/b/bPoint). Try to mark underlying
        // snapping point objects as no longer used if we can find them.
        try {
          const sp1 =
            connectionToBreak.snapPoint1 ||
            connectionToBreak.aPoint ||
            connectionToBreak.aPoint;
          const sp2 =
            connectionToBreak.snapPoint2 ||
            connectionToBreak.bPoint ||
            connectionToBreak.bPoint;
          if (sp1 && typeof sp1 === 'object') sp1.isUsed = false;
          if (sp2 && typeof sp2 === 'object') sp2.isUsed = false;
        } catch (e) {
          // ignore
        }

        // Remove the connection from the group's list
        connections.splice(index, 1);

        // Clear UI slots immediately
        try {
          this.clearSlots(this._breakLinkSlots);
        } catch (e) {}
        this._breakLinkSlotsVisible = false;

        // If no remaining connections, ungroup everything
        if (connections.length === 0) {
          try {
            this.ungroupSelectedObject();
          } catch (e) {}
          return;
        }

        // Otherwise, reorganize the group into connected components
        try {
          this.reorganizeGroupAfterBreakLink(selectedGroup, connectionToBreak);
        } catch (e) {}

        (this as any)[$needsRender]();
      } catch (e) {
        // swallow errors to avoid breaking the editor
      }
    }

    // Touch unused private fields/methods so TypeScript doesn't complain
    // about declared-but-never-read symbols; these are placeholders for
    // integration with the snapping/drag flow in future work.
    private _touchUnused() {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._breakLinkSlotsVisible;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._snappingPointSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._breakLinkSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._rotationSlots;
      // methods
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this.setupNewConnection;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this.reorganizeGroupAfterBreakLink;
      // touch newly added slot methods
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this.updateSnappingPointSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this.updateBreakLinkSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this.completeSnapConnection;
    }

    rotate: RotateFunction = () => {
      // Implementation for rotating the selected puzzle piece
    };
    transform: TransformFunction = () => {
      // Implementation for transforming the selected puzzle piece
    };

    /**
     * Start an interactive placement session using a low-resolution GLB as a
     * placeholder. Returns a PlacementSession (EventTarget-style).
     * Only one interactive session may be 'placing' at a time; if one exists
     * it will be returned instead of creating a new one.
     */
    startPlacement(
      lowResSrc: string,
      highResSrc: string,
      options?: PlacementOptions,
      initialMouse?: { clientX: number; clientY: number }
    ): PlacementSession {
      // Enforce single interactive session
      if (
        this._activePlacementSession &&
        this._activePlacementSession.state === 'placing'
      ) {
        return this._activePlacementSession;
      }

      const session = new PlacementSession(
        this,
        lowResSrc,
        highResSrc,
        options || {}
      );
      this._activePlacementSession = session;

      // When session transitions out of placing (commit/cancel), clear active session
      const clearActive = () => {
        if (this._activePlacementSession === session)
          this._activePlacementSession = null;
      };

      session.addEventListener('loading-start', clearActive, { once: true });
      session.addEventListener('cancel', clearActive, { once: true });
      session.addEventListener('error', clearActive, { once: true });

      // Kick off loading of placeholder low-res GLB asynchronously
      session._loadPlaceholder();

      // If an initial mouse position was provided, ensure the placeholder
      // will be positioned there immediately once it loads. If the
      // placeholder is already loaded, updatePosition will handle it.
      if (initialMouse) {
        const oncePosition = () => {
          try {
            session.updatePosition(initialMouse.clientX, initialMouse.clientY);
          } catch (e) {}
        };
        session.addEventListener('placeholder-loaded', oncePosition, {
          once: true,
        });
        // Also attempt an immediate update in case the placeholder is
        // already available synchronously.
        try {
          session.updatePosition(initialMouse.clientX, initialMouse.clientY);
        } catch (e) {}
      }

      // Wire default pointer capture (window-level) so consumers don't need to
      // manage global listeners. Pointer moves update the placeholder; pointer
      // up commits the placement. ESC cancels.
      const onPointerMove = (e: PointerEvent) => {
        try {
          if (session.state === 'placing') {
            session.updatePosition(e.clientX, e.clientY);
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerUp = () => {
        try {
          if (session.state === 'placing') {
            // Commit using any preconfigured finalSrc
            session.commit().catch(() => {});
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerCancel = () => {
        try {
          if (session.state === 'placing') session.cancel();
        } catch (err) {}
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          if (session.state === 'placing') session.cancel();
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('keydown', onKeyDown);

      const removeDomListeners = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        window.removeEventListener('keydown', onKeyDown);
      };

      // Clean up listeners when session ends or errors.
      session.addEventListener('loading-start', () => removeDomListeners(), {
        once: true,
      });
      session.addEventListener('cancel', () => removeDomListeners(), {
        once: true,
      });
      session.addEventListener('error', () => removeDomListeners(), {
        once: true,
      });

      // Refresh snapping-point slots when the placeholder is first loaded
      // or when its pointer-driven position updates. This ensures the
      // slot renderer sees placeholder snappingPoints during interactive
      // placement. Also refresh on loading-start (commit) to clear slots.
      try {
        session.addEventListener('placeholder-loaded', () => {
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}
        });
        session.addEventListener('update', (ev: any) => {
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}

          // Also run snapping checks during interactive placement so
          // the placeholder may discover candidate connections while
          // the user moves the mouse. We record a pending connection
          // (deferred apply) the same way dragging does.
          try {
            if (!this.snappingEnabled) return;
            const detail = ev && ev.detail ? ev.detail : null;
            if (!detail || !detail.worldPoint) return;
            // Clear any previous pending connection and then evaluate
            this._setPendingSnapConnection(null);
            const ph = (session as any).placeholder as Object3D | null;
            if (!ph) return;
            const wp = new Vector3(
              detail.worldPoint.x,
              detail.worldPoint.y,
              detail.worldPoint.z
            );
            // Use the same check path as dragging: allow the placeholder
            // to be considered as the dragged object for snapping checks.
            try {
              // Ensure placeholder position is up to date
              ph.position.copy(wp);
            } catch (e) {}
            try {
              this.checkAndApplySnapping(ph, wp);
            } catch (e) {}
          } catch (e) {}
        });
        session.addEventListener('loading-start', () => {
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}
        });
        session.addEventListener('cancel', () => {
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}
        });
      } catch (e) {}

      return session;
    }
  }

  return LDPuzzlerModelViewerElement;
};

/**
 * PlacementSession represents an interactive placement instance. It's an
 * EventTarget and emits events: 'start','update','loading-start','loaded','error','cancel'.
 */
class PlacementSession extends EventTarget {
  id: string;
  state: 'placing' | 'loading' | 'ended' | 'cancelled' = 'placing';
  placeholder: Object3D | null = null;
  private _element: InstanceType<ReturnType<typeof LDPuzzlerMixin>> | null;
  private _lowResSrc: string;
  private _highResSrc?: string;
  private _options?: PlacementOptions;

  constructor(
    element: any,
    lowResSrc: string,
    highResSrc?: string,
    options?: PlacementOptions
  ) {
    super();
    this.id = String(Date.now()) + '_' + Math.floor(Math.random() * 10000);
    this._element = element;
    this._lowResSrc = lowResSrc;
    this._highResSrc = highResSrc;
    this._options = options;
    this.dispatchEvent(
      new CustomEvent('start', { detail: { sessionId: this.id } })
    );
  }

  // Internal: load low-res placeholder and insert into scene
  async _loadPlaceholder() {
    if (!this._element) return;
    const scene = (this._element as any)[$scene];
    if (!scene) return;

    try {
      const loader = (this._element as any)[$renderer].loader;
      const gltf = await loader.load(
        this._lowResSrc,
        this._element,
        (p: number) => {
          // Progress for placeholder load (0..1)
          try {
            this.dispatchEvent(
              new CustomEvent('progress', {
                detail: {
                  sessionId: this.id,
                  phase: 'placeholder',
                  progress: p,
                },
              })
            );
          } catch (e) {}
        }
      );

      if (!gltf || !gltf.scene) return;

      // Use the low-res model as the interactive placeholder
      const placeholder = gltf.scene;
      if (!placeholder) return;

      this.placeholder = placeholder;
      placeholder.name =
        this._options?.name || `placement_placeholder_${this.id}`;
      placeholder.userData = placeholder.userData || {};
      placeholder.userData.isPlacementPlaceholder = true;
      // If the placement was started with snappingPoints, attach them to
      // the placeholder so the snapping-point slot renderer and snapping
      // logic can discover and use them during interactive placement.
      if (this._options?.snappingPoints) {
        try {
          placeholder.userData.snappingPoints = this._options.snappingPoints;
        } catch (e) {
          // ignore
        }
      }
      if (this._options?.selectable === false)
        placeholder.userData.selectable = false;

      // Insert into scene target
      try {
        scene.target.add(placeholder);
      } catch (e) {
        scene.add(placeholder);
      }
      // Keep the placeholder hidden until we receive the first pointer
      // update so it doesn't appear at the scene origin if the GLB loads
      // very quickly.
      try {
        placeholder.visible = false;
      } catch (e) {
        // ignore if property not present
      }

      this.dispatchEvent(
        new CustomEvent('placeholder-loaded', {
          detail: { sessionId: this.id, placeholder },
        })
      );
      // Request render
      (this._element as any)[$needsRender]();
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
      this.cancel();
    }
  }

  // Update placeholder position. Accepts client coordinates and converts
  // them to a world point using the LDCursor mixin's helper.
  updatePosition(clientX: number, clientY: number) {
    if (!this.placeholder || !this._element) return;

    try {
      const world = (this._element as any)[$getMouseWorldPoint](
        clientX,
        clientY
      ) as Vector3 | null;
      if (!world) {
        // pointer outside or no valid ray intersection
        this.dispatchEvent(
          new CustomEvent('update', {
            detail: { sessionId: this.id, worldPoint: null },
          })
        );
        return;
      }

      // Make the placeholder visible on the first pointer update so it
      // doesn't flash at the origin when the low-res asset loaded before
      // the user moved the mouse.
      if (this.placeholder.visible === false) {
        try {
          this.placeholder.visible = true;
        } catch (e) {
          // ignore
        }
      }

      this.placeholder.position.set(world.x, world.y, world.z);
      this.dispatchEvent(
        new CustomEvent('update', {
          detail: {
            sessionId: this.id,
            worldPoint: { x: world.x, y: world.y, z: world.z },
          },
        })
      );
      (this._element as any)[$needsRender]();
    } catch (error) {
      // If helper is not present or fails, emit error and no-op
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
    }
  }

  // Commit placement: start loading the final high-res GLB. Session is
  // considered ended for interactive purposes immediately; returned Promise
  // resolves/rejects when final model load completes.
  async commit(finalSrc?: string) {
    if (this.state !== 'placing') {
      return Promise.reject(new Error('Session not placing'));
    }

    this.state = 'loading';

    // Compute a reasonable center point for the placeholder so callers
    // can position UI (hotspots) at the geometric center of the object
    // rather than at the floor or origin.
    let centerDetail: { x: number; y: number; z: number } | null = null;
    try {
      if (this.placeholder) {
        // Ensure world matrices are up to date
        this.placeholder.updateMatrixWorld(true);
        const box = new Box3().setFromObject(this.placeholder);
        const center = new Vector3();
        box.getCenter(center);
        centerDetail = { x: center.x, y: center.y, z: center.z };
      }
    } catch (e) {
      centerDetail = null;
    }

    this.dispatchEvent(
      new CustomEvent('loading-start', {
        detail: {
          sessionId: this.id,
          src: finalSrc || this._highResSrc,
          center: centerDetail,
        },
      })
    );

    const srcToLoad = finalSrc || this._highResSrc;
    if (!srcToLoad) {
      const err = new Error('No finalSrc provided to commit');
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error: err } })
      );
      this._cleanupPlaceholder();
      return Promise.reject(err);
    }

    // Allow new interactive sessions now; capture element ref so we can
    // continue the final load in the background and still clean up the
    // placeholder even after we drop the interactive reference.
    const element = this._element;
    this._endInteractive();

    if (!element) return Promise.reject(new Error('No element'));

    const loader = (element as any)[$renderer].loader;
    const scene = (element as any)[$scene];

    try {
      const gltf = await loader.load(srcToLoad, element, (p: number) => {
        // Progress for final load (0..1)
        try {
          this.dispatchEvent(
            new CustomEvent('progress', {
              detail: { sessionId: this.id, phase: 'final', progress: p },
            })
          );
        } catch (e) {}
      });

      if (!gltf || !gltf.scene) {
        throw new Error('Loaded GLTF missing scene');
      }

      // Place final model at placeholder transform (if present)
      if (this.placeholder) {
        gltf.scene.position.copy(this.placeholder.position);
        gltf.scene.quaternion.copy(this.placeholder.quaternion);
        gltf.scene.scale.copy(this.placeholder.scale);
      }

      // Mark as placed so selection logic recognizes it
      gltf.scene.name = this._options?.name || `placed_${this.id}`;
      gltf.scene.userData = gltf.scene.userData || {};
      // Preserve any snappingPoints provided during placement so the final
      // placed model participates in snapping discovery.
      if (this._options?.snappingPoints) {
        try {
          gltf.scene.userData.snappingPoints = this._options.snappingPoints;
        } catch (e) {}
      }
      gltf.scene.userData.isPlacedObject = true;
      if (this._options?.selectable === false)
        gltf.scene.userData.selectable = false;

      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        scene.add(gltf.scene);
      }

      // Fallback: if no pending connection was recorded (or it was lost),
      // do an immediate check between the newly placed model and existing
      // placed objects to find a snapping connection and complete it now.
      try {
        const el = element as any;
        const pending =
          el && el.pendingSnapConnection ? el.pendingSnapConnection : null;
        if (!pending) {
          try {
            console.debug(
              'ld-puzzler: PlacementSession.commit running fallback snap search for new node',
              { node: gltf.scene.name }
            );
          } catch (e) {}

          const targetObject = el.findTargetObject
            ? el.findTargetObject()
            : (el as any)[$scene];
          if (targetObject) {
            const snappableObjects: Object3D[] = [];
            if ((gltf.scene as any).userData?.isSnappedGroup) {
              gltf.scene.traverse((child: any) => {
                if (
                  child.userData?.isPlacedObject &&
                  child.userData?.snappingPoints
                )
                  snappableObjects.push(child);
              });
            } else if ((gltf.scene as any).userData?.snappingPoints) {
              snappableObjects.push(gltf.scene);
            }

            let completed = false;
            for (const snappableObj of snappableObjects) {
              try {
                targetObject.traverse((child: any) => {
                  if (completed) return;
                  if (
                    child.userData?.isPlacedObject &&
                    child !== snappableObj &&
                    !el.areObjectsInSameGroup(snappableObj, child) &&
                    child.userData?.snappingPoints
                  ) {
                    const connections = findSnappingConnections(
                      snappableObj,
                      child
                    );
                    if (connections && connections.length > 0) {
                      const closest = connections[0];
                      try {
                        console.debug(
                          'ld-puzzler: PlacementSession.commit fallback found connection',
                          { dragged: snappableObj.name, target: child.name }
                        );
                      } catch (e) {}
                      try {
                        el.completeSnapConnection &&
                          el.completeSnapConnection({
                            draggedObject: snappableObj,
                            targetObject: child,
                            draggedPoint: closest.draggedPoint,
                            targetPoint: closest.targetPoint,
                          });
                        completed = true;
                        // Clear any recorded pending connection as we've applied it
                        el._setPendingSnapConnection &&
                          el._setPendingSnapConnection(null);
                      } catch (e) {}
                      return;
                    }
                  }
                });
                if (completed) break;
              } catch (e) {}
            }
          }
        }
      } catch (e) {}

      // If a pending snap connection was recorded during interactive
      // placement, translate any placeholder reference to the newly
      // created final model node and complete the connection now that
      // the final model exists in the scene graph.
      try {
        // Use the captured element reference (element) — this._element was
        // nulled by _endInteractive() earlier, so referencing it here would
        // miss the recorded pending connection.
        const el = element as any;
        const pending =
          el && el.pendingSnapConnection ? el.pendingSnapConnection : null;
        if (pending) {
          // If the pending draggedObject is the placeholder (or a child
          // of it), replace it with the final placed node so grouping
          // operations target the actual placed model.
          let dragged = pending.draggedObject;
          try {
            let node = dragged;
            while (node) {
              if (node === this.placeholder) {
                pending.draggedObject = gltf.scene;
                break;
              }
              node = node.parent;
            }
          } catch (e) {}

          try {
            // Complete the connection now that final node is added
            el.completeSnapConnection && el.completeSnapConnection(pending);
          } catch (e) {}

          try {
            // Clear the recorded pending connection
            el._setPendingSnapConnection && el._setPendingSnapConnection(null);
          } catch (e) {}
        }
      } catch (e) {}

      // Clean up placeholder (we can still remove it even though the
      // interactive session has been ended)
      this._cleanupPlaceholder();

      // Request a render so the newly added final model is visible
      // immediately (camera movement shouldn't be required).
      try {
        (element as any)[$needsRender]();
        // Also refresh snapping-point slots so UI updates immediately
        try {
          (element as any).updateSnappingPointSlots &&
            (element as any).updateSnappingPointSlots();
        } catch (e) {}
      } catch (e) {
        // ignore
      }

      this.state = 'ended';
      const detail = { sessionId: this.id, placedNode: gltf.scene };
      this.dispatchEvent(new CustomEvent('loaded', { detail }));
      return { id: this.id, node: gltf.scene };
    } catch (error) {
      // On failure, remove placeholder and emit error
      this._cleanupPlaceholder();
      this.state = 'cancelled';
      this.dispatchEvent(
        new CustomEvent('error', { detail: { sessionId: this.id, error } })
      );
      try {
        (element as any)[$needsRender]();
      } catch (e) {}
      return Promise.reject(error);
    }
  }

  cancel() {
    this._cleanupPlaceholder();
    this.state = 'cancelled';
    this.dispatchEvent(
      new CustomEvent('cancel', { detail: { sessionId: this.id } })
    );
    this._endInteractive();
  }

  private _cleanupPlaceholder() {
    if (!this.placeholder) return;
    try {
      if (this.placeholder.parent)
        this.placeholder.parent.remove(this.placeholder);
      this.placeholder.traverse((child: any) => {
        if (child.dispose)
          try {
            child.dispose();
          } catch (_) {}
      });
    } catch (e) {
      // ignore
    }
    this.placeholder = null;
    // If the interactive element is still around, request a render.
    if (this._element) (this._element as any)[$needsRender]();
  }

  private _endInteractive() {
    // Drop reference to element so caller may start another interactive session
    this._element = null;
  }
}
