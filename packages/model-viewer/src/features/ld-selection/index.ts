/* @license
 * Copyright 2024 London Dynamics. All Rights Reserved.
 */

/**
 * LDSelectionMixin - Centralized selection management for model-viewer
 *
 * This mixin provides object selection capabilities based on a configurable
 * selection scope. Selection works independently of any mode (edit, measure, etc.),
 * allowing other mixins to control their own behavior while reacting to selection changes.
 *
 * KEY PRINCIPLE: Selection is universal - users can always click to select objects.
 * Individual mixins decide what to do with selections based on their own properties.
 *
 * USAGE FOR OTHER MIXINS:
 *
 * 1. Extend from this mixin:
 * ```typescript
 * export const MyMixin = <T extends Constructor<ModelViewerElementBase>>(
 *   ModelViewerElement: T
 * ) => {
 *   const SelectionBase = LDSelectionMixin(ModelViewerElement);
 *
 *   class MyMixinElement extends SelectionBase {
 *     // Your mixin code here
 *   }
 *   return MyMixinElement;
 * };
 * ```
 *
 * 2. Listen to selection-change events:
 * ```typescript
 * class MyMixinElement extends SelectionBase {
 *   @property({ type: Boolean, attribute: 'my-feature' })
 *   myFeature: boolean = false;
 *
 *   connectedCallback() {
 *     super.connectedCallback();
 *     (this as any).addEventListener('selection-change', this._onSelectionChange);
 *   }
 *
 *   private _onSelectionChange = (event: Event) => {
 *     const customEvent = event as CustomEvent<SelectionChangeDetail>;
 *     const { selectedObjects, scope, type } = customEvent.detail;
 *
 *     // Only act if your feature is enabled AND objects are selected
 *     if (this.myFeature && type === 'select' && selectedObjects.length > 0) {
 *       // Enable your feature for selected objects
 *       console.log('Feature enabled for:', selectedObjects);
 *     } else {
 *       // Disable your feature
 *       console.log('Feature disabled');
 *     }
 *   };
 * }
 * ```
 *
 * 3. Access selection state:
 * ```typescript
 * // Get current selection
 * const selected = this.getSelectedObject();
 * const allSelected = this.getSelectedObjects();
 *
 * // Check if object is selected
 * if (this.isSelected(someObject)) {
 *   // Object is selected
 * }
 *
 * // Programmatically change selection
 * this.selectPart(partObject);
 * this.selectGroup(groupObject);
 * this.clearSelection();
 * ```
 *
 * SELECTION SCOPE:
 * - 'part': Select individual placed objects
 * - 'group': Select groups (or individual objects as single-object groups)
 * - 'all': Allow any scene node to be selected
 *
 * MULTI-SELECT:
 * Hold Shift while clicking to add/remove items from the selection.
 *
 * EVENTS:
 * The mixin dispatches 'selection-change' events with the following detail:
 * ```typescript
 * {
 *   selectedObjects: Object3D[];  // Array of currently selected objects
 *   scope: SelectionScope;        // Current selection scope
 *   type: 'select' | 'deselect' | 'clear';  // Type of change
 * }
 * ```
 */

import {property} from 'lit/decorators.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
} from '../../model-viewer-base.js';
import {Constructor} from '../../utilities.js';
import {Object3D, Vector2, Raycaster, Box3, Vector3, Camera} from 'three';

import {scrubSelectionOutlineLayers} from './selection-outline-layers.js';

// Re-export the selection outline effect
export {SelectionOutlineEffect} from './selection-outline-effect.js';
export {
  SELECTION_OUTLINE_LAYER,
  scrubSelectionOutlineLayers,
} from './selection-outline-layers.js';

const MULTI_SELECT_MODIFIER_KEY = 'Shift' as const;

const RECT_PROJECTION_BOX = new Box3();
const RECT_PROJECTION_CORNER = new Vector3();
const RECT_PROJECTION_VIEW = new Vector3();

export type SelectionScope = 'scene' | 'part' | 'group' | 'all';

export type DomRectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type RectangleSelectionMode = 'replace' | 'add' | 'remove' | 'toggle';

export interface SelectionChangeDetail {
  selectedObjects: Object3D[];
  metadata: Array<Record<string, unknown>>;
  selectedObjectSurfaceSnapState: Array<{
    uuid: string;
    name: string;
    isSurfaceSnapped: boolean;
  }>;
  isSurfaceSnapped: boolean;
  scope: SelectionScope;
  type: 'select' | 'deselect' | 'clear';
}

export interface LDSelectionInterface {
  disableBaseModelSelection: boolean;
  selectAll(): void;
  deselectAll(): void;
  applyRectangleSelection(
    rect: DomRectLike,
    options?: {mode?: RectangleSelectionMode}
  ): void;
}

/**
 * LDSelectionMixin handles object selection in edit mode based on a configurable
 * selection scope (part, group, or all). It emits selection-change events that
 * other mixins can listen to and react to.
 */
export const LDSelectionMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDSelectionInterface> & T => {
  class LDSelectionModelViewerElement extends ModelViewerElement {
    /**
     * Which selection mode is active. Options:
     * - 'part': select individual parts (closest placed object, or PuzzlerRoot as fallback)
     * - 'group' (default): select groups (closest group node, or parent of closest PuzzlerRoot as fallback)
     * - 'scene': don't select anything
     * - 'all': allow any scene node to be selected
     */
    @property({type: String, attribute: 'selection-scope'})
    selectionScope: SelectionScope = 'scene';

    @property({type: Boolean, attribute: 'highlight-selected'})
    highlightSelected: boolean = false;

    @property({type: Boolean, attribute: 'disable-base-model-selection'})
    disableBaseModelSelection: boolean = false;

    // Track selected objects
    protected selectedObjects: Object3D[] = [];
    protected _selectedGroups: Set<Object3D> = new Set();

    // Raycaster for selection (protected so child mixins can use them for other purposes)
    protected raycaster: Raycaster = new Raycaster();
    protected currentMousePosition: Vector2 = new Vector2();

    // Drag detection state for selection
    private _selectionMouseDownTime: number = 0;
    private _selectionMouseDownPosition: Vector2 = new Vector2();
    private _isDragging: boolean = false;

    /**
     * Return true when the node passes the scope & selectable checks
     */
    protected _isInteractivePlacementActive(): boolean {
      const session = (this as any)._activePlacementSession;
      if (
        !!session &&
        (session.state === 'placing' || session.state === 'loading')
      ) {
        return true;
      }
      const pasteSession = (this as any)._activePasteSession;
      return pasteSession?.state === 'previewing';
    }

    protected _isMultiSelectModifierActive(e: PointerEvent | MouseEvent): boolean {
      return e.getModifierState(MULTI_SELECT_MODIFIER_KEY);
    }

    protected _isNodeSelectable(node: any): boolean {
      if (!node) return false;
      if (node.userData?.isPlacementPlaceholder === true) return false;
      if (node.userData?.isPasteGhost === true) return false;
      if (node.selectable === false || node.userData?.selectable === false)
        return false;

      const name = node.name || '';
      const isPlaced = node.userData.isPlacedObject === true;
      const isPuzzlerRoot = name === 'PuzzlerRoot';
      const isGroup = node.userData?.isSnappedGroup === true || isPuzzlerRoot;

      // Check if we're working with placed objects (puzzler mode) or regular models
      const scene = (this as any)[$scene];
      let hasPlacedObjects = false;
      if (scene) {
        const targetObject = this._findTargetObject();
        if (targetObject) {
          targetObject.traverse((child: any) => {
            if (child.userData?.isPlacedObject === true) {
              hasPlacedObjects = true;
            }
          });
        }
      }

      switch (this.selectionScope) {
        case 'part':
          // For placed objects: only select placed objects or puzzler root
          // For regular models: select any named node
          if (hasPlacedObjects) {
            return isPlaced || isPuzzlerRoot;
          } else {
            return !!name; // Any named node in the model
          }
        case 'group':
          // For placed objects: allow groups or individual placed parts
          // For regular models: select any node
          if (hasPlacedObjects) {
            return isGroup || isPlaced || isPuzzlerRoot;
          } else {
            return true; // Any node in regular models
          }
        case 'all':
          return true;
        default:
          return false;
      }
    }

    connectedCallback() {
      super.connectedCallback();
      // Select on pointer down (capture) so click-and-drag can select and move in one gesture.
      (this as any).addEventListener(
        'pointerdown',
        this._onPointerDownForSelection as EventListener,
        true
      );
      // Use pointerup in the capture phase to reliably detect clicks on the
      // canvas even if inner handlers stop propagation. Keep click as a
      // fallback for browsers that may not trigger pointer events.
      (this as any).addEventListener(
        'mousedown',
        this._onMouseDown as EventListener
      );
      (this as any).addEventListener(
        'mousemove',
        this._onMouseMove as EventListener
      );
      (this as any).addEventListener(
        'pointerup',
        this._onPointerEvent as EventListener,
        true
      );
      (this as any).addEventListener(
        'click',
        this._onPointerEvent as EventListener
      );
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      (this as any).removeEventListener(
        'pointerdown',
        this._onPointerDownForSelection as EventListener,
        true
      );
      (this as any).removeEventListener(
        'mousedown',
        this._onMouseDown as EventListener
      );
      (this as any).removeEventListener(
        'mousemove',
        this._onMouseMove as EventListener
      );
      (this as any).removeEventListener(
        'pointerup',
        this._onPointerEvent as EventListener,
        true
      );
      (this as any).removeEventListener(
        'click',
        this._onPointerEvent as EventListener
      );
      // Clear highlights
      this._clearHighlights();
      // Clear any selection state when removed
      this.clearSelection();
    }

    /**
     * Helper method to check if an event target is a UI element that should not trigger selection changes.
     * Returns true if the target is a UI element (slotted element, data-no-raycast, etc.)
     */
    protected _isUIElement(target: EventTarget | null): boolean {
      if (!target) return false;
      const element = target as HTMLElement;
      if (!element) return false;

      const host = this as unknown as HTMLElement;

      // Light DOM controls (slotted overlays, buttons, panels) live outside the
      // shadow canvas and must not drive scene selection raycasts.
      if (
        element !== host &&
        typeof host.contains === 'function' &&
        host.contains(element)
      ) {
        const root = host.shadowRoot;
        if (!root || !root.contains(element as Node)) {
          return true;
        }
      }

      // Check if target has slot attribute or is within a slotted element
      if (element.hasAttribute?.('slot') || element.closest?.('[slot]')) {
        return true;
      }

      // Check if target is within an element marked as data-no-raycast
      if (element.closest?.('[data-no-raycast]')) {
        return true;
      }

      return false;
    }

    /**
     * Select on pointer down (capture phase) so that click-and-drag selects and moves in one gesture.
     * Runs before other handlers so the object is selected before modular's mousedown considers drag.
     */
    protected _shouldDeferSelectionPointer(e: PointerEvent | MouseEvent): boolean {
      const skip = (this as any)._shouldSkipSelectionPointerEvent;
      if (typeof skip !== 'function' || !skip.call(this, e)) {
        return false;
      }
      const consume = (this as any)._consumeSelectionPointerSuppression;
      if (typeof consume === 'function') {
        consume.call(this, e);
      }
      return true;
    }

    protected _onPointerDownForSelection = (e: PointerEvent | MouseEvent) => {
      const btn = (e as any).button;
      if (btn !== 0) return;
      if (this._isUIElement(e.target)) return;
      if (this._shouldDeferSelectionPointer(e)) return;
      if (this._isMultiSelectModifierActive(e)) return;
      try {
        this._performSelectionRaycast(e, {
          clearWhenNoHit: false,
          phase: 'pointerdown',
        });
      } catch (error) {
        console.error('[selection]: raycast error on pointerdown', error);
      }
    };

    protected _onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this._isUIElement(e.target)) return;

      // Update mouse position
      const rect = (this as any).getBoundingClientRect();
      this.currentMousePosition.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      // Record mousedown state for drag detection
      this._selectionMouseDownTime = performance.now();
      this._selectionMouseDownPosition.copy(this.currentMousePosition);
      this._isDragging = false;
    };

    protected _onMouseMove = (e: MouseEvent) => {
      if (this._selectionMouseDownTime === 0) return;

      // Update mouse position
      const rect = (this as any).getBoundingClientRect();
      this.currentMousePosition.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      // Check if user has dragged (camera orbit/pan)
      const distance = this.currentMousePosition.distanceTo(
        this._selectionMouseDownPosition
      );
      if (distance > 0.01) {
        this._isDragging = true;
      }
    };

    protected _onPointerEvent = (e: PointerEvent | MouseEvent) => {
      // pointerup and click both fire for the same gesture; handle once.
      if (e.type === 'click' && typeof window.PointerEvent !== 'undefined') {
        return;
      }

      // Avoid reacting to non-primary buttons or events with undefined button
      const btn = (e as any).button;
      if (btn !== 0) {
        return;
      }

      // Skip selection if dragging occurred (camera movement, not a click)
      if (this._isDragging) {
        this._selectionMouseDownTime = 0;
        this._isDragging = false;
        return;
      }

      // Check if the event was stopped by something
      if (e.cancelBubble || (e as any).defaultPrevented) {
        return;
      }

      const target = e.target as HTMLElement;
      if (!target) {
        return;
      }

      // IMPORTANT: Don't clear selection when clicking on UI elements.
      if (this._isUIElement(target)) {
        return;
      }

      if (this._shouldDeferSelectionPointer(e)) {
        this._selectionMouseDownTime = 0;
        this._isDragging = false;
        return;
      }

      try {
        this._performSelectionRaycast(e, {phase: 'pointerup'});
      } catch (error) {
        console.error('[selection]: raycast error', error);
      }

      this._selectionMouseDownTime = 0;
      this._isDragging = false;
    };

    /**
     * @param e - pointer/mouse event for raycast position
     * @param options.clearWhenNoHit - if true (default), clear selection when raycast hits nothing.
     *   Pass false for pointer-down so we only deselect on click (pointer up on empty), not when starting a camera drag.
     */
    protected _performSelectionRaycast(
      e: PointerEvent | MouseEvent,
      options?: {
        clearWhenNoHit?: boolean;
        phase?: 'pointerdown' | 'pointerup';
      }
    ) {
      const clearWhenNoHit = options?.clearWhenNoHit !== false;
      const phase = options?.phase ?? 'pointerup';
      const multiSelect = this._isMultiSelectModifierActive(e);

      if (this._isInteractivePlacementActive()) {
        this.clearSelection();
        return;
      }

      const objectToSelect = this._resolveObjectFromRaycast(e);

      if (!objectToSelect) {
        if (clearWhenNoHit && !multiSelect) {
          this.clearSelection();
        }
        return;
      }

      if (phase === 'pointerdown') {
        if (multiSelect) return;
        if (this.isSelected(objectToSelect)) return;
        this._replaceSelection([objectToSelect]);
        return;
      }

      // pointerup / click
      if (multiSelect) {
        this._toggleInSelection(objectToSelect);
        return;
      }

      if (!this.isSelected(objectToSelect)) {
        this._replaceSelection([objectToSelect]);
      }
    }

    protected _resolveObjectFromRaycast(
      e: PointerEvent | MouseEvent
    ): Object3D | null {
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      this.currentMousePosition.set(mouseX, mouseY);

      const scene = (this as any)[$scene];
      if (!scene) {
        return null;
      }

      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) {
        return null;
      }

      this.raycaster.setFromCamera(this.currentMousePosition, camera);

      const targetObject = this._findTargetObject();
      if (!targetObject) {
        return null;
      }

      const allPlacedObjects: Object3D[] = [];
      targetObject.traverse((child: any) => {
        if (child.userData?.isPlacedObject === true) {
          allPlacedObjects.push(child);
        }
      });

      const objectsToRaycast =
        allPlacedObjects.length > 0 ? allPlacedObjects : [targetObject];

      const allIntersects = this.raycaster.intersectObjects(
        objectsToRaycast,
        true
      );

      const intersects = allIntersects.filter(
        (hit) =>
          hit.object.visible &&
          !hit.object.userData?.noHit &&
          hit.object.userData?.isPlacementPlaceholder !== true &&
          hit.object.userData?.selectable !== false
      );

      if (intersects.length === 0) {
        return null;
      }

      let objectToSelect: Object3D | null = null;
      let intersectedObject = intersects[0].object;
      const hasPlacedObjects = allPlacedObjects.length > 0;

      if (hasPlacedObjects) {
        while (
          intersectedObject &&
          intersectedObject.parent &&
          intersectedObject.userData?.isPlacedObject !== true
        ) {
          intersectedObject = intersectedObject.parent as Object3D;
        }
      } else {
        while (
          intersectedObject &&
          intersectedObject.parent &&
          !intersectedObject.name &&
          intersectedObject.type === 'Object3D'
        ) {
          intersectedObject = intersectedObject.parent as Object3D;
        }
      }

      switch (this.selectionScope) {
        case 'part':
          if (hasPlacedObjects) {
            if (
              intersectedObject &&
              intersectedObject.userData?.isPlacedObject === true
            ) {
              objectToSelect = intersectedObject;
            }
          } else {
            objectToSelect = intersectedObject;
          }
          break;

        case 'group':
          if (hasPlacedObjects) {
            if (
              intersectedObject &&
              intersectedObject.userData?.isPlacedObject === true
            ) {
              const group = this._findEnclosingGroup(intersectedObject);
              objectToSelect = group || intersectedObject;
            }
          } else {
            objectToSelect = intersectedObject?.parent?.name
              ? intersectedObject.parent
              : intersectedObject;
          }
          break;

        case 'all':
          objectToSelect = intersectedObject;
          break;
      }

      if (
        objectToSelect &&
        objectToSelect.userData?.isPlacementPlaceholder !== true &&
        this._isNodeSelectable(objectToSelect)
      ) {
        return objectToSelect;
      }

      return null;
    }

    protected _findEnclosingGroup(obj: Object3D | null): Object3D | null {
      let node = obj;
      while (node) {
        if (node.userData?.isSnappedGroup === true) return node;
        node = node.parent as Object3D | null;
      }
      return null;
    }

    protected _isInsideSnappedGroup(obj: Object3D): boolean {
      return this._findEnclosingGroup(obj) !== null;
    }

    protected _findTargetObject(): Object3D | null {
      const scene = (this as any)[$scene];
      try {
        return scene?.target || scene?.model || null;
      } catch (e) {
        return null;
      }
    }

    protected _trackGroupInSelection(object: Object3D) {
      if (object.userData?.isSnappedGroup === true) {
        this._selectedGroups.add(object);
      }
    }

    protected _untrackGroupInSelection(object: Object3D) {
      if (object.userData?.isSnappedGroup === true) {
        this._selectedGroups.delete(object);
      }
    }

    protected _addToSelection(object: Object3D) {
      if (object?.userData?.isPlacementPlaceholder === true) return;
      if (this._isInteractivePlacementActive()) return;
      if (this.isSelected(object)) return;

      this.selectedObjects.push(object);
      this._trackGroupInSelection(object);

      if (this.highlightSelected) {
        this._updateHighlight();
      }

      this._dispatchSelectionChange('select');
      (this as any)[$needsRender]();
    }

    protected _removeFromSelection(object: Object3D) {
      if (!this.isSelected(object)) return;

      this.selectedObjects = this.selectedObjects.filter((o) => o !== object);
      this._untrackGroupInSelection(object);

      if (this.highlightSelected) {
        this._updateHighlight();
      }

      if (this.selectedObjects.length === 0) {
        this._dispatchSelectionChange('clear');
      } else {
        this._dispatchSelectionChange('deselect');
      }
      (this as any)[$needsRender]();
    }

    protected _toggleInSelection(object: Object3D) {
      if (this.isSelected(object)) {
        this._removeFromSelection(object);
      } else {
        this._addToSelection(object);
      }
    }

    protected _replaceSelection(objects: Object3D[]) {
      const valid = objects.filter(
        (o) =>
          o &&
          o.userData?.isPlacementPlaceholder !== true &&
          !this._isInteractivePlacementActive()
      );
      if (valid.length === 0) {
        this.clearSelection();
        return;
      }

      const sameSelection =
        valid.length === this.selectedObjects.length &&
        valid.every((o, i) => this.selectedObjects[i] === o);
      if (sameSelection) return;

      this.selectedObjects = [...valid];
      this._selectedGroups.clear();
      for (const obj of this.selectedObjects) {
        this._trackGroupInSelection(obj);
      }

      if (this.highlightSelected) {
        this._updateHighlight();
      }

      this._dispatchSelectionChange('select');
      (this as any)[$needsRender]();
    }

    protected _selectObject(object: Object3D) {
      this._replaceSelection([object]);
    }

    protected _applySelectionFromObjects(
      objects: Object3D[],
      mode: RectangleSelectionMode = 'replace'
    ) {
      const selectable = objects.filter((o) => this._isNodeSelectable(o));
      switch (mode) {
        case 'replace':
          this._replaceSelection(selectable);
          break;
        case 'add':
          for (const obj of selectable) {
            this._addToSelection(obj);
          }
          break;
        case 'remove':
          for (const obj of selectable) {
            this._removeFromSelection(obj);
          }
          break;
        case 'toggle':
          for (const obj of selectable) {
            this._toggleInSelection(obj);
          }
          break;
      }
    }

    protected _isRectangleSelectionReady(rect: DomRectLike): boolean {
      if (rect.right <= rect.left || rect.bottom <= rect.top) {
        return false;
      }

      const scene = (this as any)[$scene];
      if (!scene) return false;

      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return false;

      if (scene.width <= 0 || scene.height <= 0) return false;

      return true;
    }

    /**
     * Inverse of ModelScene.getNDC — maps projected NDC to client/viewport coords.
     */
    protected _ndcToClient(
      ndcX: number,
      ndcY: number,
      elementRect: DOMRect,
      viewportWidth: number,
      viewportHeight: number
    ): {clientX: number; clientY: number} {
      return {
        clientX: elementRect.left + (ndcX * 0.5 + 0.5) * viewportWidth,
        clientY: elementRect.top + (-ndcY * 0.5 + 0.5) * viewportHeight,
      };
    }

    protected _projectObjectBoundsToDomRect(
      object: Object3D,
      camera: Camera,
      elementRect: DOMRect,
      viewportWidth: number,
      viewportHeight: number
    ): DomRectLike | null {
      object.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      RECT_PROJECTION_BOX.setFromObject(object);
      if (RECT_PROJECTION_BOX.isEmpty()) return null;

      const {min, max} = RECT_PROJECTION_BOX;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      let anyVisible = false;

      for (let xi = 0; xi < 2; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          for (let zi = 0; zi < 2; zi++) {
            RECT_PROJECTION_CORNER.set(
              xi ? max.x : min.x,
              yi ? max.y : min.y,
              zi ? max.z : min.z
            );
            // Skip corners behind the camera (view-space +Z is behind).
            RECT_PROJECTION_VIEW.copy(RECT_PROJECTION_CORNER).applyMatrix4(
              camera.matrixWorldInverse
            );
            if (RECT_PROJECTION_VIEW.z >= 0) continue;

            RECT_PROJECTION_CORNER.project(camera);
            if (RECT_PROJECTION_CORNER.z >= 1) continue;

            // Clamp NDC to the viewport. Unclamped off-screen corners inflate the
            // screen AABB (false hits when siblings are off-screen); clamping also
            // keeps zoomed-in objects selectable when their bbox exceeds the frustum.
            const ndcX = Math.max(
              -1,
              Math.min(1, RECT_PROJECTION_CORNER.x)
            );
            const ndcY = Math.max(
              -1,
              Math.min(1, RECT_PROJECTION_CORNER.y)
            );

            anyVisible = true;
            const {clientX, clientY} = this._ndcToClient(
              ndcX,
              ndcY,
              elementRect,
              viewportWidth,
              viewportHeight
            );
            left = Math.min(left, clientX);
            right = Math.max(right, clientX);
            top = Math.min(top, clientY);
            bottom = Math.max(bottom, clientY);
          }
        }
      }

      if (!anyVisible) return null;
      return {left, top, right, bottom};
    }

    /**
     * Projects selectable object bounds to DOM coords and tests rect intersection.
     * Host marquee UI calls applyRectangleSelection at high frequency.
     */
    protected _querySelectableObjectsInDomRect(rect: DomRectLike): Object3D[] {
      const scene = (this as any)[$scene];
      if (!scene) return [];

      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return [];

      const element = this as unknown as HTMLElement;
      const elementRect = element.getBoundingClientRect();
      const viewportWidth = scene.width;
      const viewportHeight = scene.height;
      if (viewportWidth <= 0 || viewportHeight <= 0) return [];

      const candidates = this._enumerateSelectableObjects();
      const hits: Object3D[] = [];

      for (const obj of candidates) {
        const bounds = this._projectObjectBoundsToDomRect(
          obj,
          camera,
          elementRect,
          viewportWidth,
          viewportHeight
        );
        if (!bounds) continue;
        const intersects =
          bounds.right >= rect.left &&
          bounds.left <= rect.right &&
          bounds.bottom >= rect.top &&
          bounds.top <= rect.bottom;
        if (intersects) {
          hits.push(obj);
        }
      }

      return hits;
    }

    protected _enumerateSelectableObjects(): Object3D[] {
      const targetObject = this._findTargetObject();
      if (!targetObject) return [];

      if (this.selectionScope === 'scene') {
        return [];
      }

      const results: Object3D[] = [];
      const seen = new Set<string>();

      const addUnique = (node: Object3D) => {
        if (!node || seen.has(node.uuid)) return;
        if (!this._isNodeSelectable(node)) return;
        seen.add(node.uuid);
        results.push(node);
      };

      switch (this.selectionScope) {
        case 'part':
          targetObject.traverse((child: any) => {
            if (child.userData?.isPlacedObject === true) {
              addUnique(child);
            }
          });
          break;

        case 'group': {
          targetObject.traverse((child: any) => {
            if (
              child.userData?.isSnappedGroup === true ||
              child.name === 'PuzzlerRoot'
            ) {
              addUnique(child);
            }
          });
          targetObject.traverse((child: any) => {
            if (
              child.userData?.isPlacedObject === true &&
              !this._isInsideSnappedGroup(child)
            ) {
              addUnique(child);
            }
          });
          break;
        }

        case 'all':
          targetObject.traverse((child: any) => {
            addUnique(child);
          });
          break;
      }

      return results;
    }

    selectAll(): void {
      if (this.selectionScope === 'scene') return;
      const objects = this._enumerateSelectableObjects();
      if (objects.length === 0) return;
      this._replaceSelection(objects);
    }

    deselectAll(): void {
      this.clearSelection();
    }

    applyRectangleSelection(
      rect: DomRectLike,
      options?: {mode?: RectangleSelectionMode}
    ): void {
      if (!this._isRectangleSelectionReady(rect)) return;
      const hits = this._querySelectableObjectsInDomRect(rect);
      this._applySelectionFromObjects(hits, options?.mode ?? 'replace');
    }

    /**
     * Update visual highlight for selected objects.
     * Uses the outline-effect or ld-outline-effect component if present.
     */
    protected _updateHighlight() {
      const scene = (this as any)[$scene];
      const highlightRoot = scene?.target || scene;
      if (highlightRoot) {
        scrubSelectionOutlineLayers(highlightRoot);
      }

      const effectComposer = (this as unknown as HTMLElement).querySelector(
        'effect-composer'
      );
      if (!effectComposer) {
        return;
      }

      const outlineEffect =
        effectComposer.querySelector('selection-outline-effect') ||
        effectComposer.querySelector('outline-effect') ||
        effectComposer.querySelector('ld-outline-effect');

      if (!outlineEffect) {
        return;
      }

      if (this.selectedObjects.length > 0) {
        const meshes: Object3D[] = [];
        for (const obj of this.selectedObjects) {
          obj.traverse((child: Object3D) => {
            if ((child as any).isMesh) {
              meshes.push(child);
            }
          });
        }

        (outlineEffect as any).selection = meshes;
        outlineEffect.setAttribute('blend-mode', 'default');
      } else {
        (outlineEffect as any).selection = [];
        outlineEffect.setAttribute('blend-mode', 'skip');
      }

      (this as any)[$needsRender]();
    }

    /**
     * Clear all visual highlights.
     */
    protected _clearHighlights() {
      const scene = (this as any)[$scene];
      const highlightRoot = scene?.target || scene;
      if (highlightRoot) {
        scrubSelectionOutlineLayers(highlightRoot);
      }

      const effectComposer = (this as unknown as HTMLElement).querySelector(
        'effect-composer'
      );
      if (!effectComposer) return;

      const outlineEffect =
        effectComposer.querySelector('selection-outline-effect') ||
        effectComposer.querySelector('outline-effect') ||
        effectComposer.querySelector('ld-outline-effect');

      if (outlineEffect) {
        (outlineEffect as any).selection = [];
        outlineEffect.setAttribute('blend-mode', 'skip');
      }
    }

    protected _dispatchSelectionChange(type: 'select' | 'deselect' | 'clear') {
      const selectedObjectSurfaceSnapState = this.selectedObjects.map(
        (object) => ({
          uuid: object.uuid,
          name: object.name || '',
          isSurfaceSnapped: this._isObjectSurfaceSnapped(object),
        })
      );
      const detail: SelectionChangeDetail = {
        selectedObjects: [...this.selectedObjects],
        metadata: this.selectedObjects.map((object) => ({
          ...(object.userData || {}),
        })),
        selectedObjectSurfaceSnapState,
        isSurfaceSnapped:
          selectedObjectSurfaceSnapState.length > 0
            ? selectedObjectSurfaceSnapState[0].isSurfaceSnapped
            : false,
        scope: this.selectionScope,
        type,
      };

      (this as any).dispatchEvent(
        new CustomEvent('selection-change', {
          detail,
          bubbles: true,
          composed: true,
        })
      );
    }

    protected _isObjectSurfaceSnapped(object: Object3D): boolean {
      if (!object) return false;
      if (object.userData?.isSurfaceSnapped === true) return true;

      if (object.userData?.isSnappedGroup === true) {
        let hasSnappedChild = false;
        object.traverse((child) => {
          if (hasSnappedChild) return;
          if (child.userData?.isSurfaceSnapped === true) {
            hasSnappedChild = true;
          }
        });
        return hasSnappedChild;
      }

      return false;
    }

    /**
     * Get the currently selected node based on selection scope
     */
    getSelectedObject(): Object3D | null {
      return this.selectedObjects.length > 0 ? this.selectedObjects[0] : null;
    }

    /**
     * Get all currently selected objects
     */
    getSelectedObjects(): Object3D[] {
      return [...this.selectedObjects];
    }

    /**
     * Select a specific part (regardless of current selection scope)
     */
    selectPart(node: Object3D): boolean {
      if (!node) return false;
      try {
        if (!node.userData?.isPlacedObject) {
          console.warn('[selection]: selectPart: node is not a placed object');
          return false;
        }
        this._selectObject(node);
        return true;
      } catch (e) {
        console.error('[selection]: selectPart error:', e);
        return false;
      }
    }

    /**
     * Select a specific group (regardless of current selection scope)
     */
    selectGroup(node: Object3D): boolean {
      if (!node) return false;
      if (!node.userData?.isSnappedGroup && node.name !== 'PuzzlerRoot')
        return false;
      try {
        this._selectObject(node);
        return true;
      } catch (e) {
        console.error('[selection]: selectGroup error:', e);
        return false;
      }
    }

    /**
     * Clear current selection
     */
    clearSelection(): void {
      if (this.selectedObjects.length === 0) return;

      this.selectedObjects = [];
      this._selectedGroups.clear();

      if (this.highlightSelected) {
        this._updateHighlight();
      }

      this._dispatchSelectionChange('clear');
      (this as any)[$needsRender]();
    }

    /**
     * Check if an object is currently selected
     */
    isSelected(object: Object3D): boolean {
      return this.selectedObjects.includes(object);
    }

    /**
     * Update mouse position from event
     */
    protected updateMousePosition(event: {clientX: number; clientY: number}) {
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      this.currentMousePosition.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y = -(
        ((event.clientY - rect.top) / rect.height) * 2 -
        1
      );
    }
  }

  return LDSelectionModelViewerElement;
};
