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

import { property } from 'lit/decorators.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
} from '../../model-viewer-base.js';
import { Constructor } from '../../utilities.js';
import { Object3D, Vector2, Raycaster } from 'three';

// Re-export the selection outline effect
export { SelectionOutlineEffect } from './selection-outline-effect.js';

export type SelectionScope = 'scene' | 'part' | 'group' | 'all';

export interface SelectionChangeDetail {
  selectedObjects: Object3D[];
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
    @property({ type: String, attribute: 'selection-scope' })
    selectionScope: SelectionScope = 'scene';

    @property({ type: Boolean, attribute: 'highlight-selected' })
    highlightSelected: boolean = false;

    @property({ type: Boolean, attribute: 'disable-base-model-selection' })
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
    protected _isNodeSelectable(node: any): boolean {
      if (!node) return false;
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
    protected _onPointerDownForSelection = (e: PointerEvent | MouseEvent) => {
      const btn = (e as any).button;
      if (btn !== 0) return;
      if (this._isUIElement(e.target)) return;
      try {
        this._performSelectionRaycast(e, { clearWhenNoHit: false });
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
      // Avoid reacting to non-primary buttons or events with undefined button
      const btn = (e as any).button;
      if (btn !== 0) {
        return;
      }

      // Skip selection if dragging occurred (camera movement, not a click)
      if (this._isDragging) {
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

      try {
        this._performSelectionRaycast(e);
      } catch (error) {
        console.error('[selection]: raycast error', error);
      }
    };

    /**
     * @param e - pointer/mouse event for raycast position
     * @param options.clearWhenNoHit - if true (default), clear selection when raycast hits nothing.
     *   Pass false for pointer-down so we only deselect on click (pointer up on empty), not when starting a camera drag.
     */
    protected _performSelectionRaycast(
      e: PointerEvent | MouseEvent,
      options?: { clearWhenNoHit?: boolean }
    ) {
      const clearWhenNoHit = options?.clearWhenNoHit !== false;
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      this.currentMousePosition.set(mouseX, mouseY);

      const scene = (this as any)[$scene];
      if (!scene) {
        return;
      }

      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) {
        return;
      }

      this.raycaster.setFromCamera(this.currentMousePosition, camera);

      // Find the target object (scene.target or scene root)
      const targetObject = this._findTargetObject();
      if (!targetObject) {
        return;
      }

      // Collect all placed objects for raycasting
      const allPlacedObjects: Object3D[] = [];
      targetObject.traverse((child: any) => {
        if (child.userData?.isPlacedObject === true) {
          allPlacedObjects.push(child);
        }
      });

      // If no placed objects, use the entire target object tree (for regular models)
      const objectsToRaycast =
        allPlacedObjects.length > 0 ? allPlacedObjects : [targetObject];

      // Perform raycast
      const allIntersects = this.raycaster.intersectObjects(
        objectsToRaycast,
        true
      );

      // Filter out objects marked as noHit (e.g., measurement lines, helpers)
      // and objects marked as not selectable
      const intersects = allIntersects.filter(
        (hit) =>
          hit.object.visible &&
          !hit.object.userData?.noHit &&
          hit.object.userData?.selectable !== false
      );

      if (intersects.length === 0) {
        if (clearWhenNoHit) {
          this.clearSelection();
        }
        return;
      }

      // Find the appropriate object based on selection scope
      let objectToSelect: Object3D | null = null;
      let intersectedObject = intersects[0].object;

      // Walk up the hierarchy to find a placed object (if working with placed objects)
      // or a meaningful model node (if working with regular models)
      const hasPlacedObjects = allPlacedObjects.length > 0;

      if (hasPlacedObjects) {
        // Walk up to find placed object
        while (
          intersectedObject &&
          intersectedObject.parent &&
          intersectedObject.userData?.isPlacedObject !== true
        ) {
          intersectedObject = intersectedObject.parent as Object3D;
        }
      } else {
        // For regular models, walk up to find a named node or mesh
        while (
          intersectedObject &&
          intersectedObject.parent &&
          !intersectedObject.name &&
          intersectedObject.type === 'Object3D'
        ) {
          intersectedObject = intersectedObject.parent as Object3D;
        }
      }

      // Apply selection scope logic
      switch (this.selectionScope) {
        case 'part':
          // Select the intersected object directly (placed object or model part)
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
          // Find the enclosing group, or the object itself if not in a group
          if (hasPlacedObjects) {
            if (
              intersectedObject &&
              intersectedObject.userData?.isPlacedObject === true
            ) {
              const group = this._findEnclosingGroup(intersectedObject);
              objectToSelect = group || intersectedObject;
            }
          } else {
            // For regular models, select the parent node or the object itself
            objectToSelect = intersectedObject?.parent?.name
              ? intersectedObject.parent
              : intersectedObject;
          }
          break;

        case 'all':
          // Select whatever was hit
          objectToSelect = intersectedObject;
          break;
      }

      if (objectToSelect && this._isNodeSelectable(objectToSelect)) {
        this._selectObject(objectToSelect);
      } else {
        this.clearSelection();
      }
    }

    protected _findEnclosingGroup(obj: Object3D | null): Object3D | null {
      let node = obj;
      while (node) {
        // Support both legacy `isGroup` marker and newer `isSnappedGroup` marker
        if (node.userData?.isSnappedGroup === true) return node;
        node = node.parent as Object3D | null;
      }
      return null;
    }

    protected _findTargetObject(): Object3D | null {
      // Prefer scene.target if present, otherwise the scene root
      const scene = (this as any)[$scene];
      try {
        return scene?.target || scene?.model || null;
      } catch (e) {
        return null;
      }
    }

    protected _selectObject(object: Object3D) {
      // Check if already selected
      if (
        this.selectedObjects.length === 1 &&
        this.selectedObjects[0] === object
      ) {
        return;
      }

      // Clear previous selection
      this.selectedObjects = [object];

      // Update groups set
      this._selectedGroups.clear();
      if (object.userData?.isSnappedGroup === true) {
        this._selectedGroups.add(object);
      }

      // Update highlight if enabled
      if (this.highlightSelected) {
        this._updateHighlight();
      }

      // Dispatch selection-change event
      this._dispatchSelectionChange('select');

      (this as any)[$needsRender]();
    }

    /**
     * Update visual highlight for selected objects.
     * Uses the outline-effect or ld-outline-effect component if present.
     */
    protected _updateHighlight() {
      // Find the effect-composer element
      const effectComposer = (this as unknown as HTMLElement).querySelector(
        'effect-composer'
      );
      if (!effectComposer) {
        return;
      }

      // Find the outline effect element (supports outline-effect, ld-outline-effect, and selection-outline-effect)
      const outlineEffect =
        effectComposer.querySelector('selection-outline-effect') ||
        effectComposer.querySelector('outline-effect') ||
        effectComposer.querySelector('ld-outline-effect');

      if (!outlineEffect) {
        return;
      }

      if (this.selectedObjects.length > 0) {
        // Collect all meshes from selected objects for the outline effect
        const meshes: Object3D[] = [];
        for (const obj of this.selectedObjects) {
          obj.traverse((child: Object3D) => {
            if ((child as any).isMesh) {
              meshes.push(child);
            }
          });
        }

        // IMPORTANT: Set the selection FIRST, then enable the effect
        // This ensures the selection is already set when updateEffects() rebuilds the passes
        (outlineEffect as any).selection = meshes;

        // Now enable the effect (this rebuilds effect passes with the selection already set)
        outlineEffect.setAttribute('blend-mode', 'default');
      } else {
        // Clear the selection first, then disable
        (outlineEffect as any).selection = [];

        // Disable the effect by setting blend mode to skip
        outlineEffect.setAttribute('blend-mode', 'skip');
      }

      // Queue a render to show the updated highlight
      (this as any)[$needsRender]();
    }

    /**
     * Clear all visual highlights.
     */
    protected _clearHighlights() {
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
        // Disable the effect by setting blend mode to skip
        outlineEffect.setAttribute('blend-mode', 'skip');
      }
    }

    protected _dispatchSelectionChange(type: 'select' | 'deselect' | 'clear') {
      const selectedObjectSurfaceSnapState = this.selectedObjects.map((object) => ({
        uuid: object.uuid,
        name: object.name || '',
        isSurfaceSnapped: this._isObjectSurfaceSnapped(object),
      }));
      const detail: SelectionChangeDetail = {
        selectedObjects: [...this.selectedObjects],
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

      // Clear highlight if enabled
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
    protected updateMousePosition(event: { clientX: number; clientY: number }) {
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
