import { property } from 'lit/decorators.js';
import {
  Object3D,
  Vector3,
  Box3,
  Raycaster,
  Vector2,
  Plane,
  Quaternion,
  EulerOrder,
} from 'three';
import type { Part } from '@london-dynamics/types/product';

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

import { getErrorMessage } from '../../utilities/errors.js';

import { $controls } from '../controls.js';
import { updateSlots, createSlotElement } from './slots.js';
import { Euler } from 'three';
import {
  $selectObjectForControls,
  $clearSelectedObject,
} from '../ld-floating-control-strip.js';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { LDExporter } from '../ld-exporter.js';
import { createSafeObjectUrlFromArrayBuffer } from '../../utilities/create_object_url.js';
import {
  createQuatAnimation,
  stepQuatAnimations,
  createScaleAnimation,
  stepScaleAnimations,
} from '../../utilities/animation.js';

// Re-export SnappingPoint type for external use
export type { SnappingPoint };

export type PlacementOptions = {
  mass?: number;
  name?: string;
  id?: string;
  part?: Partial<Part>;
  selectable?: boolean;
  editable?: boolean;
  snappingPoints?: SnappingPoint[]; // Optional snap points with position and rotation relative to object center
  // Callback to fetch the low-res URL
  getLowResUrl?: () => Promise<string | undefined>;
  // Callback to fetch the high-res URL
  getHighResUrl?: () => Promise<string | undefined>;
};

type SelectionScope = 'part' | 'group' | 'all';

type PositionOptions = {
  position?: Vector3;
  rotation?: Euler;
  scale?: Vector3;
  anchor?: string;
};

type LoadFunction = (src: string, id: string) => Promise<GLTF>;
type LoadManyFunction = (
  items: Array<{ src: string; id: string }>
) => Promise<GLTF[]>;

type AttachFunction = (
  objectId: string,
  targetId?: string,
  options?: PositionOptions
) => void;
type AttachMaterialFunction = (materialId: string, targetId: string) => void;

type ClearSceneFunction = () => void;

type RotationOptions = {
  order?: EulerOrder;
  animate?: boolean;
};

export declare interface LDPuzzlerInterface {
  load: LoadFunction;
  loadMany: LoadManyFunction;
  attachObject: AttachFunction;
  attachMaterial: AttachMaterialFunction;
  clear: ClearSceneFunction;

  setPosition(objectName: string, value: [number, number, number]): void;
  setRotation(
    objectName: string,
    anglesDegrees: [number, number, number],
    options?: RotationOptions
  ): void;
  setScale(objectName: string, value: [number, number, number]): void;

  setRotationX(
    objectName: string,
    x: number | string,
    options?: RotationOptions
  ): void;
  setRotationY(
    objectName: string,
    y: number | string,
    options?: RotationOptions
  ): void;
  setRotationZ(
    objectName: string,
    z: number | string,
    options?: RotationOptions
  ): void;
  setPositionX(objectName: string, x: number): void;
  setPositionY(objectName: string, y: number): void;
  setPositionZ(objectName: string, z: number): void;

  setScaleX(objectName: string, sx: number): void;
  setScaleY(objectName: string, sy: number): void;
  setScaleZ(objectName: string, sz: number): void;

  getPosition(objectName: string): [number, number, number];
  getRotation(objectName: string): [number, number, number];
  getScale(objectName: string): [number, number, number];

  setSrcFromBuffer(buffer: ArrayBuffer): void;

  deDraco: (inputBuffer: ArrayBuffer) => Promise<ArrayBuffer>;

  beginPlacement: (
    lowResSrc: string | undefined,
    highResSrc: string | undefined,
    options?: PlacementOptions,
    initialMouse?: { clientX: number; clientY: number }
  ) => any;

  replacePart: (
    objectUuid: string,
    src?: string,
    options?: PlacementOptions
  ) => Promise<void>;

  // Higher-level API functions
  getSelectedObject: () => Object3D | null;
  selectPart?: (node: Object3D) => boolean;
  selectGroup?: (node: Object3D) => boolean;
  ungroupSelectedObject?: () => boolean;
  clearSelection?: () => void;

  removeObject: (objectName: string, options?: { animate?: boolean }) => void;

  deleteNode?: (node: Object3D) => boolean;
  groupSelectedObjects?: () => Object3D | null;
  breakGroup?: (group: Object3D) => boolean;
  breakLink?: (connectionId: string) => boolean;
}

export const LDPuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'edit-mode' })
    editMode: boolean = false;

    @property({ type: Number, attribute: 'snap-distance' })
    snapDistance: number = 0.2; // Default snap distance in meters

    @property({ type: Number, attribute: 'snap-hysteresis' })
    snapHysteresis: number = 1.5; // Multiplier for unsnap distance (prevents immediate re-snapping)

    @property({ type: Boolean, attribute: 'snapping-enabled' })
    snappingEnabled: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-points-visible' })
    snappingPointsVisible: boolean = false;
    // (snapping-debug removed)

    /**
     * Which selection mode is active. Options:
     * - 'part': select individual parts (closest placed object, or PuzzlerRoot as fallback)
     * - 'group' (default): select groups (closest group node, or parent of closest PuzzlerRoot as fallback)
     * - 'all': allow any scene node to be selected
     */
    @property({ type: String, attribute: 'selection-scope' })
    selectionScope: SelectionScope = 'group';

    // Return true only when edit-mode is enabled and the node passes the scope & selectable checks
    _isNodeSelectable(node: any): boolean {
      if (!this.editMode) return false;
      if (!node) return false;
      if (node.selectable === false || node.userData?.selectable === false)
        return false;

      const name = node.name || '';
      const isPlaced = node.userData.isPlacedObject === true;
      const isPuzzlerRoot = name === 'PuzzlerRoot';
      const isGroup = node.userData?.isSnappedGroup === true || isPuzzlerRoot;

      switch (this.selectionScope) {
        case 'part':
          return isPlaced || isPuzzlerRoot;
        case 'group':
          // In group mode, allow selection of both actual groups AND individual placed objects
          // Individual objects are treated as single-object "groups" for dragging
          return isGroup || isPlaced;
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

    disconnectedCallback() {
      super.disconnectedCallback();
      this.cancelRequestedShadowUpdate();
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
        // Clean up 3D snapping point meshes
        this.clearSlots(this._snappingPointSlots);
        // Clear hysteresis tracking
        this._recentlyDisconnectedPairs.clear();
      } catch (e) {}
      try {
        // reference touch helper to silence unused-method lint
        this._touchUnused();
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
        // Update snapping points when they should be visible
        const shouldShowSnappingPoints =
          this.snappingPointsVisible ||
          (this.selectedObjects && this.selectedObjects.length > 0) ||
          (this._activePlacementSession &&
            this._activePlacementSession.state === 'placing') ||
          (this.isDragging && this.snappingEnabled);

        if (shouldShowSnappingPoints) {
          this.updateSnappingPointSlots();
        }
      } catch (e) {}
      try {
        if (this._breakLinkSlotsVisible) this.updateBreakLinkSlots();
      } catch (e) {}

      // Step rotation animations (framerate independent) and clear shadow
      // update pending flags. `delta` is the time since the last tick and
      // is used to advance animations by real time rather than frame count.
      try {
        // Step registered quaternion and scale animations (delta is in ms)
        const rotBefore = this._rotationAnimationMap.size;
        stepQuatAnimations(this._rotationAnimationMap, delta);
        const rotAfter = this._rotationAnimationMap.size;

        const scaleBefore = this._scaleAnimationMap.size;
        stepScaleAnimations(this._scaleAnimationMap, delta);
        const scaleAfter = this._scaleAnimationMap.size;

        if (
          rotBefore > 0 ||
          rotAfter > 0 ||
          scaleBefore > 0 ||
          scaleAfter > 0
        ) {
          this.requestShadowUpdate();
          this[$needsRender]();
        }
      } catch (e) {}

      // Process any pending shadow update requested via requestShadowUpdate()
      try {
        if (this._shadowUpdatePending) {
          this._shadowUpdatePending = false;
          // Ensure a render is requested so shadow maps (or other per-frame
          // updates) can be updated by the render loop.
          this[$needsRender]();
        }
      } catch (e) {}
    }

    async setSrcFromBuffer(buffer: ArrayBuffer) {
      try {
        const safeObjectUrl = createSafeObjectUrlFromArrayBuffer(buffer);

        this.setAttribute('src', safeObjectUrl.url);
      } catch (e) {
        console.error(e);
      }
    }

    private _puzzleRegistry: Map<string, GLTF> = new Map();

    private _currentObject: Object3D | undefined = undefined;

    // Track in-progress rotation animations so they can be stepped from [$tick]
    // Map<Object3D, QuatAnimation>
    private _rotationAnimationMap: Map<Object3D, any> = new Map();

    // Track in-progress scale animations (for removal/scale-out)
    private _scaleAnimationMap: Map<Object3D, any> = new Map();

    async load(src: string, id: string): Promise<GLTF> {
      const loader = new GLTFLoader();

      return new Promise((resolve, reject) => {
        loader.load(
          src,
          (gltf) => {
            gltf.scene.name = id;
            gltf.scene.userData.isPuzzle = true;

            this._puzzleRegistry.set(id, gltf);

            resolve(gltf);
          },
          (xhr) => {
            this._loadStatusMap.set(id, {
              loaded: xhr.loaded,
              total: xhr.total,
              error: false,
            });

            this.dispatchEvent(
              new CustomEvent('progress', {
                detail: {
                  totalProgress: this._loadProgress,
                  reason: 'puzzle-load',
                },
              })
            );
          },
          (err) => {
            this._loadStatusMap.set(id, {
              loaded: 0,
              total: 0,
              error: true,
              message: getErrorMessage(err),
            });
            reject(err);
          }
        );
      });
    }

    unload(id: string) {
      this.detachObject(id);
      this._puzzleRegistry.delete(id);
    }

    async loadMany(srcs: Array<{ src: string; id: string }>) {
      this.clearLoadProgress();
      const promises = srcs.map((item) => this.load(item.src, item.id));
      return Promise.all(promises);
    }

    private _loadStatusMap: Map<
      string,
      { loaded: number; total: number; error?: boolean; message?: string }
    > = new Map();

    private get _loadProgress() {
      const statuses = Array.from(this._loadStatusMap.values());
      if (statuses.length === 0) return 1;
      const loaded = statuses.reduce((acc, s) => acc + s.loaded, 0);
      const total = statuses.reduce((acc, s) => acc + s.total, 0);
      return loaded / total;
    }

    clearLoadProgress() {
      this._loadStatusMap.clear();
    }

    attachObject(id: string, target?: string, options?: PositionOptions) {
      console.log('attachObject', id, 'to', target, 'with options', options);
    }

    detachObject(id: string) {
      console.log('detachObject', id);
    }

    attachMaterial(id: string) {
      console.log('attachMaterial', id);
    }

    clear() {}

    // private [$updateFramingThrottled] = throttle(async () => {
    //   await this[$scene].updateFraming();
    //   this[$needsRender]();
    // }, 400);

    setRotation(
      name: string,
      value: [number | string, number | string, number | string],
      options?: RotationOptions
    ) {
      const { order = 'XYZ', animate = false } = options || {};

      // Accept either absolute numeric degrees or relative strings like
      // "+90", "-45", "+=90" (relatively add/subtract). Validation
      // is intentionally permissive for numeric strings as well.
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value.some(
          (angle) =>
            !(
              typeof angle === 'number' ||
              (typeof angle === 'string' && relOrNumRE.test(angle))
            )
        )
      ) {
        throw new Error(
          'Invalid value array. Expected an array of three numbers (absolute degrees) or strings like "+90" / "-45" for relative changes.'
        );
      }

      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }

      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }

      if (!this._currentObject) return;

      const obj = this._currentObject as Object3D;

      // If this object is currently animating, ignore any new instructions
      // (prevents competing instructions causing small overshoots when callers
      // spam "+=..." while an animation is running).
      if (this._rotationAnimationMap.has(obj)) {
        return;
      }

      // Seed current rotation in degrees (fallback to zeros on error).
      // When animating, derive the current rotation from the object's
      // quaternion to avoid races with in-flight animations; otherwise
      // use getRotation which reads the Euler directly.
      let current: [number, number, number] = [0, 0, 0];
      if (animate) {
        try {
          const startEuler = new Euler().setFromQuaternion(
            obj.quaternion,
            order
          );
          current = [
            startEuler.x * (180 / Math.PI),
            startEuler.y * (180 / Math.PI),
            startEuler.z * (180 / Math.PI),
          ];
        } catch (e) {
          // keep zeros
        }
      } else {
        try {
          current = this.getRotation(name);
        } catch (e) {
          // keep zeros
        }
      }

      // Parse inputs: detect relative vs absolute for each axis and extract
      // numeric deltas/values. We'll prefer an incremental-quaternion path when
      // all non-relative axes match the current rotation (typical for
      // setRotationX/Y/Z helpers), so repeated "+=90" calls always rotate
      // in the intended direction.

      const parsed: {
        isRelative: boolean;
        delta?: number; // degrees for relative
        absolute?: number; // degrees for absolute
      }[] = [0, 1, 2].map((i) => {
        const input = value[i];
        if (typeof input === 'number') {
          return { isRelative: false, absolute: input };
        }
        const s = String(input).trim();
        // Relative syntax: "+90", "-45", "+=90", "-=45"
        const relMatch = s.match(/^([+-])=?\s*([+-]?\d+(?:\.\d+)?)$/);
        if (relMatch) {
          const sign = relMatch[1] === '-' ? -1 : 1;
          const val = parseFloat(relMatch[2]);
          return { isRelative: true, delta: sign * val };
        }
        // Fallback: parse absolute numeric string
        const parsedNum = parseFloat(s);
        if (!Number.isNaN(parsedNum))
          return { isRelative: false, absolute: parsedNum };
        throw new Error(`Invalid rotation input: "${input}"`);
      });

      // Determine if delta-quaternion approach is safe: any relative inputs
      // AND all absolute inputs match the current rotation (so callers used
      // helpers that seeded the non-modified axes with current values).
      const hasRelative = parsed.some((p) => p.isRelative);
      const allAbsoluteMatchCurrent = parsed.every((p, i) => {
        if (p.isRelative) return true;
        // small epsilon to allow floating point differences
        const eps = 1e-6;
        return Math.abs((p.absolute ?? 0) - current[i]) < eps;
      });

      let endQuat: Quaternion;
      let rotation: Euler | null = null;

      if (animate && hasRelative && allAbsoluteMatchCurrent) {
        // Build a delta Euler from the relative deltas and convert to a
        // quaternion. We'll apply this delta to the current quaternion so
        // the rotation direction matches the sign of the delta.
        const deltaDegs: [number, number, number] = [
          parsed[0].isRelative ? parsed[0].delta! : 0,
          parsed[1].isRelative ? parsed[1].delta! : 0,
          parsed[2].isRelative ? parsed[2].delta! : 0,
        ];
        const deltaEuler = new Euler(
          deltaDegs[0] * (Math.PI / 180),
          deltaDegs[1] * (Math.PI / 180),
          deltaDegs[2] * (Math.PI / 180),
          order
        );
        const deltaQuat = new Quaternion().setFromEuler(deltaEuler);
        const startQuat = obj.quaternion.clone();
        endQuat = startQuat.clone().multiply(deltaQuat);
        // rotation left null because we're animating quaternions directly
      } else {
        // Compute final absolute degrees for each axis (current + delta for
        // relative inputs, absolute for absolute inputs).
        const finalDegs: [number, number, number] = [0, 1, 2].map((i) =>
          parsed[i].isRelative
            ? current[i] + parsed[i].delta!
            : parsed[i].absolute ?? current[i]
        ) as [number, number, number];

        rotation = new Euler(
          finalDegs[0] * (Math.PI / 180),
          finalDegs[1] * (Math.PI / 180),
          finalDegs[2] * (Math.PI / 180),
          order
        );
        endQuat = new Quaternion().setFromEuler(rotation);
      }

      if (!animate) {
        // Immediate set (existing behavior)
        obj.rotation.copy(rotation!);
        this.requestShadowUpdate();
        this[$needsRender]();
        return;
      }

      // Animated path: slerp between current quaternion and target quaternion
      try {
        // Do not cancel any existing animation here — we already prevented
        // new instructions from starting while an animation is active. Use
        // the current quaternion as the start and register an animation
        // state that will be stepped from [$tick](time, delta). This makes
        // the animation framerate independent.
        const startQuat = obj.quaternion.clone();

        this._rotationAnimationMap.set(
          obj,
          createQuatAnimation(startQuat, endQuat)
        );

        // Ensure we render so [$tick] will be entered and the animation
        // state will begin progressing on the next frame.
        this.requestShadowUpdate();
        this[$needsRender]();
        return;
      } catch (e) {
        // Fallback to immediate set on error: prefer quaternion end if
        // available, otherwise use rotation Euler.
        try {
          if (typeof endQuat !== 'undefined') {
            obj.quaternion.copy(endQuat);
          } else if (rotation) {
            obj.rotation.copy(rotation);
          }
        } catch (err) {
          // ignore
        }
        this.requestShadowUpdate();
        this[$needsRender]();
      }
    }

    /**
     * Convenience: set single rotation axis (degrees) without clobbering others.
     * These call through to `setRotation` after seeding the existing rotation
     * (via `getRotation`) so callers can update one axis at a time.
     */
    setRotationX(name: string, x: number | string, options?: RotationOptions) {
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof x !== 'number' &&
        !(typeof x === 'string' && relOrNumRE.test(x))
      ) {
        throw new Error('Invalid x value for setRotationX');
      }
      let rot: [number | string, number | string, number | string] = [0, 0, 0];
      try {
        rot = this.getRotation(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      rot[0] = x;
      this.setRotation(name, rot as any, options);
    }

    setRotationY(name: string, y: number | string, options?: RotationOptions) {
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof y !== 'number' &&
        !(typeof y === 'string' && relOrNumRE.test(y))
      ) {
        throw new Error('Invalid y value for setRotationY');
      }
      let rot: [number | string, number | string, number | string] = [0, 0, 0];
      try {
        rot = this.getRotation(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      rot[1] = y;
      this.setRotation(name, rot as any, options);
    }

    setRotationZ(name: string, z: number | string, options?: RotationOptions) {
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof z !== 'number' &&
        !(typeof z === 'string' && relOrNumRE.test(z))
      ) {
        throw new Error('Invalid z value for setRotationZ');
      }
      let rot: [number | string, number | string, number | string] = [0, 0, 0];
      try {
        rot = this.getRotation(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      rot[2] = z;
      this.setRotation(name, rot as any, options);
    }

    /**
     * Set absolute local position (meters) for the named object.
     * value: [x, y, z]
     */
    setPosition(name: string, value: [number, number, number]) {
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value.some((v) => typeof v !== 'number')
      ) {
        throw new Error(
          'Invalid value array. Expected an array of three numbers representing position [x,y,z].'
        );
      }

      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }

      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }

      if (!this._currentObject) return;

      const obj = this._currentObject as Object3D;
      try {
        obj.position.set(value[0], value[1], value[2]);
      } catch (e) {
        // ignore invalid sets
      }

      this.requestShadowUpdate();
      this[$needsRender]();
    }

    /**
     * Convenience: set single position axis without clobbering others.
     * These call through to `setPosition` after seeding the existing
     * position (via `getPosition`) so callers can update one axis at a time.
     */
    setPositionX(name: string, x: number) {
      if (typeof x !== 'number' || Number.isNaN(x)) {
        throw new Error('Invalid x value for setPositionX');
      }
      let pos: [number, number, number] = [0, 0, 0];
      try {
        pos = this.getPosition(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      pos[0] = x;
      this.setPosition(name, pos);
    }

    setPositionY(name: string, y: number) {
      if (typeof y !== 'number' || Number.isNaN(y)) {
        throw new Error('Invalid y value for setPositionY');
      }
      let pos: [number, number, number] = [0, 0, 0];
      try {
        pos = this.getPosition(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      pos[1] = y;
      this.setPosition(name, pos);
    }

    setPositionZ(name: string, z: number) {
      if (typeof z !== 'number' || Number.isNaN(z)) {
        throw new Error('Invalid z value for setPositionZ');
      }
      let pos: [number, number, number] = [0, 0, 0];
      try {
        pos = this.getPosition(name);
      } catch (e) {
        // ignore; fallback to zeros
      }
      pos[2] = z;
      this.setPosition(name, pos);
    }

    /**
     * Set absolute local scale for the named object.
     * value: [sx, sy, sz]
     */
    setScale(name: string, value: [number, number, number]) {
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        value.some((v) => typeof v !== 'number')
      ) {
        throw new Error(
          'Invalid value array. Expected an array of three numbers representing scale [sx,sy,sz].'
        );
      }

      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }

      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }

      if (!this._currentObject) return;

      const obj = this._currentObject as Object3D;
      try {
        obj.scale.set(value[0], value[1], value[2]);
      } catch (e) {
        // ignore invalid sets (e.g., zero/NaN)
      }

      this.requestShadowUpdate();
      this[$needsRender]();
    }

    /**
     * Convenience: set single scale axis without clobbering others.
     * These call through to `setScale` after seeding the existing
     * scale (via `getScale`) so callers can update one axis at a time.
     */
    setScaleX(name: string, sx: number) {
      if (typeof sx !== 'number' || Number.isNaN(sx)) {
        throw new Error('Invalid sx value for setScaleX');
      }
      let s: [number, number, number] = [1, 1, 1];
      try {
        s = this.getScale(name);
      } catch (e) {
        // ignore; fallback to ones
      }
      s[0] = sx;
      this.setScale(name, s);
    }

    setScaleY(name: string, sy: number) {
      if (typeof sy !== 'number' || Number.isNaN(sy)) {
        throw new Error('Invalid sy value for setScaleY');
      }
      let s: [number, number, number] = [1, 1, 1];
      try {
        s = this.getScale(name);
      } catch (e) {
        // ignore; fallback to ones
      }
      s[1] = sy;
      this.setScale(name, s);
    }

    setScaleZ(name: string, sz: number) {
      if (typeof sz !== 'number' || Number.isNaN(sz)) {
        throw new Error('Invalid sz value for setScaleZ');
      }
      let s: [number, number, number] = [1, 1, 1];
      try {
        s = this.getScale(name);
      } catch (e) {
        // ignore; fallback to ones
      }
      s[2] = sz;
      this.setScale(name, s);
    }

    getRotation(name: string): [number, number, number] {
      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }
      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }
      if (!this._currentObject) {
        throw new Error(`Object with name "${name}" not found.`);
      }

      return [
        this._currentObject.rotation.x * (180 / Math.PI),
        this._currentObject.rotation.y * (180 / Math.PI),
        this._currentObject.rotation.z * (180 / Math.PI),
      ];
    }

    getPosition(name: string): [number, number, number] {
      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }
      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }
      if (!this._currentObject) {
        throw new Error(`Object with name "${name}" not found.`);
      }

      return [
        this._currentObject.position.x,
        this._currentObject.position.y,
        this._currentObject.position.z,
      ];
    }

    getScale(name: string): [number, number, number] {
      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }
      if (!this._currentObject) {
        this._currentObject = this[$scene].getObjectByName(name);
      }
      if (!this._currentObject) {
        throw new Error(`Object with name "${name}" not found.`);
      }

      return [
        this._currentObject.scale.x,
        this._currentObject.scale.y,
        this._currentObject.scale.z,
      ];
    }

    /* Remove draco compression from a glb
     *
     * @param {ArrayBuffer} inputBuffer GLB with draco
     * @return {Promise<ArrayBuffer>} GLB without draco
     */
    deDraco(inputBuffer: ArrayBuffer): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
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
                (arrayBuffer: ArrayBuffer) => {
                  resolve(arrayBuffer);
                },
                function (err: any) {
                  console.error(err);
                  reject(err);
                },
                { binary: true }
              );
            } else {
              resolve(inputBuffer);
            }
          },
          (error) => {
            console.error(error);
            reject(error);
          }
        );
      });
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
      console.log('LDPuzzlerMixin: _onPointerEvent');
      // Ignore clicks originating from slotted elements or marked elements.
      // Slotted elements (UI panels, controls) should call stopPropagation() if
      // they want to block selection. Elements with [data-no-raycast] are
      // explicitly marked to never trigger raycasting.
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.hasAttribute('slot') ||
          target.closest('[slot]') ||
          target.closest('[data-no-raycast]'))
      )
        return;

      // Additional safety: also check if the event was stopped by something
      // (handlers should call stopPropagation to prevent unwanted selection)
      if (e.cancelBubble || (e as any).defaultPrevented) return;

      // Also check if the click came from inside the floating control strip
      // by checking if any [data-no-raycast] ancestor exists in the light DOM
      const floatingControlStrip = this.querySelector('[data-no-raycast]');
      if (floatingControlStrip && floatingControlStrip.contains(target)) return;

      // Avoid reacting to non-primary buttons
      // (PointerEvent has button, MouseEvent too)
      const btn = (e as any).button;
      if (typeof btn === 'number' && btn !== 0) return;

      console.log(
        'LDPuzzlerMixin: _onPointerEvent continued - performing raycast'
      );

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
            this.selectedObjects = [];
          } catch (e) {}
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}
          try {
            this.dispatchEvent(
              new CustomEvent('select', {
                detail: { node: null, type: 'clear' },
              })
            );
          } catch (e) {}
          return;
        }

        // Collect selectable candidates from hits.
        // Selection priority (all modes):
        // 1. isPlacedObject (user-explicitly-placed items) — highest priority
        // 2. isSnappedGroup (actual user-created groups) — group mode only
        // 3. Generic nodes (PuzzlerRoot containers, fallback)
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
          // In both part and group modes, strongly prefer isPlacedObject (user-placed items).
          // Generic PuzzlerRoot containers should only be selected if no placed items exist.
          const placed = candidates
            .filter((c) => c.node?.userData?.isPlacedObject === true)
            .sort((a, b) => a.depth - b.depth);

          if (placed.length > 0) {
            // Found a placed item; use it in any mode
            selectedNode = placed[0].node;
          } else if (this.selectionScope === 'part') {
            // Part mode, no placed items: pick the closest selectable candidate
            candidates.sort((a, b) => a.depth - b.depth);
            selectedNode = candidates[0].node;
          } else if (this.selectionScope === 'group') {
            // Group mode, no placed items: prefer snapped groups over generic PuzzlerRoot
            const groups = candidates
              .filter((c) => c.node?.userData?.isSnappedGroup === true)
              .sort((a, b) => a.depth - b.depth);
            if (groups.length > 0) {
              selectedNode = groups[0].node;
            } else {
              // Last resort: pick closest candidate
              candidates.sort((a, b) => a.depth - b.depth);
              selectedNode = candidates[0].node;
            }
          } else {
            // 'all' mode: pick the closest selectable
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

        console.log('selectedNode:', selectedNode);

        // Notify floating controls mixin, set outline selection, and record
        // the selected object so dragging targets the correct node.
        try {
          (this as any)[$selectObjectForControls](selectedNode);
        } catch (err) {}
        try {
          this.selectedObjects = selectedNode ? [selectedNode] : [];
        } catch (e) {}
        const meshes = this._getMeshesForOutline(selectedNode);
        this._setOutline(meshes);
        // Emit a public selection event so consumers can react
        try {
          const t =
            selectedNode?.userData?.isPlacedObject === true
              ? 'part'
              : selectedNode?.userData?.isSnappedGroup === true ||
                selectedNode?.name === 'PuzzlerRoot'
              ? 'group'
              : 'node';
          this.dispatchEvent(
            new CustomEvent('select', {
              detail: { node: selectedNode, type: t },
            })
          );
          // Refresh snapping point slots to reflect the new selection.
          try {
            this.updateSnappingPointSlots();
          } catch (e) {}
        } catch (e) {}
      } catch (error) {
        // swallow
      }
    };

    private _shadowUpdatePending: boolean = false;

    private requestShadowUpdate() {
      // Schedule a shadow update for the next tick. We set a pending flag
      // which is processed from [$tick] — this avoids using raw
      // requestAnimationFrame and allows the update to be driven by the
      // same tick loop the rest of the mixin uses.
      if (this._shadowUpdatePending) return;
      this._shadowUpdatePending = true;
      // Ask the render loop to run; the pending flag will be handled in [$tick]
      this[$needsRender]();
    }

    private cancelRequestedShadowUpdate() {
      // Clear any pending shadow update request. The pending flag is
      // observed and processed from [$tick].
      this._shadowUpdatePending = false;
    }

    private _activePlacementSession: PlacementSession | null = null;

    // Selection / grouping bookkeeping (from index_old)
    private selectedObjects: Object3D[] = [];
    private _selectedGroups: Set<Object3D> = new Set();
    // When dragging, prefer to move the enclosing group (if any).
    private _currentDragTarget: Object3D | null = null;

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

    // Track recently disconnected pairs for hysteresis (cleared on drag end)
    private _recentlyDisconnectedPairs: Set<string> = new Set();

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

      // Log pending connection changes for debugging
      try {
        console.debug('[puzzler] _setPendingSnapConnection ->', v);
      } catch (e) {}
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
            try {
              console.debug(
                '[puzzler] _setPendingSnapConnection applied visual alignment',
                { moverName: mover.name || mover.uuid, desiredLocal }
              );
            } catch (e) {}
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
     * Public API: ungroup the currently selected group object (if any).
     * Returns true if a group was ungrouped.
     */
    public ungroupSelectedObject(): boolean {
      if (this.selectedObjects.length !== 1) return false;
      const group = this.selectedObjects[0];
      // Only accept the canonical `isSnappedGroup` marker
      if (!group || !group.userData?.isSnappedGroup) return false;
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

        // Record all connections being broken for hysteresis logic
        const connections = group.userData?.snapConnections || [];
        connections.forEach((connection: any) => {
          // Extract object IDs from different connection formats
          let id1: string, id2: string;
          if (connection.object1 && connection.object2) {
            id1 = connection.object1.name || connection.object1.uuid;
            id2 = connection.object2.name || connection.object2.uuid;
          } else if (connection.a && connection.b) {
            id1 = connection.a;
            id2 = connection.b;
          } else {
            return; // Skip malformed connections
          }

          // Create a consistent pair key (alphabetically sorted to avoid order issues)
          const pairKey = [id1, id2].sort().join('|');
          this._recentlyDisconnectedPairs.add(pairKey);

          try {
            console.debug(
              '[puzzler] tracking disconnected pair for hysteresis',
              {
                id1,
                id2,
                pairKey,
              }
            );
          } catch (e) {}
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
            // Clear legacy/new in-group marker so child behaves as standalone
            delete child.userData.isInGroup;
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
          group.userData.isSnappedGroup = true;
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
        // Support both legacy `isGroup` marker and newer `isSnappedGroup` marker
        if (node.userData?.isSnappedGroup === true) return node;
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
        try {
          console.debug('[puzzler] mergeSnappedGroups', {
            g1: group1.name || group1.uuid,
            g2: group2.name || group2.uuid,
            connection,
          });
        } catch (e) {}
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
          child.userData.isInGroup = true;
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
        try {
          console.debug('[puzzler] addObjectToSnappedGroup', {
            group: group.name || group.uuid,
            newObject: newObject.name || newObject.uuid,
            connection,
          });
        } catch (e) {}
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
        newObject.userData.isInGroup = true;
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
        try {
          console.debug('[puzzler] completeSnapConnection focusGroup', {
            name: focusGroup.name || focusGroup.uuid,
            userData: focusGroup.userData,
          });
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

      // Ensure selection reflects the focused group (if any) so UI knows
      // which group we're operating on.
      if (focusGroup) {
        try {
          this.selectedObjects = [focusGroup];
        } catch (e) {}
      }

      try {
        console.debug('[puzzler] selection after completeSnapConnection', {
          selected:
            this.selectedObjects[0]?.name || this.selectedObjects[0]?.uuid,
          userData: this.selectedObjects[0]?.userData,
        });
      } catch (e) {}

      // Show break link slots if the selected object is a snapped/group
      if (
        this.selectedObjects.length > 0 &&
        this.selectedObjects[0].userData?.isSnappedGroup
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
        try {
          console.debug('[puzzler] reorganizeGroupAfterBreakLink', {
            name: group.name || group.uuid,
            userData: group.userData,
          });
        } catch (e) {}

        const connections = group.userData?.snapConnections || [];

        // Build adjacency map by object name. Support both legacy (a/b)
        // connection objects and the newer object1/object2 shaped objects.
        const map = new Map<string, Set<string>>();
        connections.forEach((c: any) => {
          let nameA: string | undefined;
          let nameB: string | undefined;

          if (c.a || c.b) {
            nameA = c.a;
            nameB = c.b;
          } else if (c.object1 && c.object2) {
            nameA = c.object1?.name || String(c.object1?.id);
            nameB = c.object2?.name || String(c.object2?.id);
          } else if (c.objectA && c.objectB) {
            // defensive: alternate naming
            nameA = c.objectA?.name || String(c.objectA?.id);
            nameB = c.objectB?.name || String(c.objectB?.id);
          }

          if (!nameA || !nameB) return;
          if (!map.has(nameA)) map.set(nameA, new Set());
          if (!map.has(nameB)) map.set(nameB, new Set());
          map.get(nameA)!.add(nameB);
          map.get(nameB)!.add(nameA);
        });

        // Find connected components among group's children by name
        const children = [...group.children];
        const nameToChild = new Map<string, Object3D>();
        children.forEach((c) => nameToChild.set(c.name || String(c.id), c));

        // Ensure isolated children show up in the map so they become single-node components
        nameToChild.forEach((_, name) => {
          if (!map.has(name)) map.set(name, new Set());
        });

        const visited = new Set<string>();
        const components: Object3D[][] = [];

        for (const [name] of nameToChild) {
          if (visited.has(name)) continue;
          // BFS
          const queue = [name];
          const compKeys: string[] = [];
          visited.add(name);
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
          try {
            console.debug(
              '[puzzler] reorganizeGroupAfterBreakLink nothing to split',
              {
                components: components.length,
              }
            );
          } catch (e) {}
          return;
        }

        // For each component create a new group if size > 1, otherwise reparent single objects
        components.forEach((comp, index) => {
          if (comp.length === 1) {
            const obj = comp[0];
            group.remove(obj);
            if (group.parent) group.parent.add(obj);
            if (obj.userData) {
              delete obj.userData.groupId;
              delete obj.userData.isInGroup;
            }
          } else {
            const newGroup = new Object3D();
            newGroup.name = `${group.name}_part_${index}`;
            newGroup.userData = { isSnappedGroup: true, snapConnections: [] };
            if (group.parent) group.parent.add(newGroup);
            const compNames = new Set<string>();
            comp.forEach((obj) => {
              group.remove(obj);
              newGroup.add(obj);
              obj.userData = obj.userData || {};
              obj.userData.groupId = newGroup.name;
              obj.userData.isInGroup = true;
              compNames.add(obj.name || String(obj.id));
            });

            // Transfer any connections that belong entirely to this component
            connections.forEach((c: any) => {
              // legacy shape
              if (c.a || c.b) {
                if (compNames.has(c.a) && compNames.has(c.b)) {
                  newGroup.userData.snapConnections.push({
                    id: c.id || `${c.a}_${c.b}`,
                    a: c.a,
                    b: c.b,
                    aPoint: c.aPoint,
                    bPoint: c.bPoint,
                  });
                }
              } else if (c.object1 && c.object2) {
                const na = c.object1?.name || String(c.object1?.id);
                const nb = c.object2?.name || String(c.object2?.id);
                if (compNames.has(na) && compNames.has(nb)) {
                  // attempt to resolve actual child object references under the new group
                  const objA = newGroup.getObjectByName(na) || c.object1;
                  const objB = newGroup.getObjectByName(nb) || c.object2;
                  newGroup.userData.snapConnections.push({
                    id: c.id || `${na}_${nb}`,
                    object1: objA,
                    object2: objB,
                    snapPoint1: c.snapPoint1,
                    snapPoint2: c.snapPoint2,
                  });
                }
              }
            });

            this.updateGroupMeshCache(newGroup);
          }
        });

        // Remove original group if empty
        if (group.children.length === 0 && group.parent)
          group.parent.remove(group);

        // Defensive cleanup: any remaining child that is not under a snapped
        // group should not have lingering in-group metadata.
        nameToChild.forEach((child) => {
          if (child.parent && !child.parent.userData?.isSnappedGroup) {
            if (child.userData) {
              if (child.userData.isInGroup) delete child.userData.isInGroup;
              if (child.userData.groupId) delete child.userData.groupId;
            }
          }
        });

        try {
          console.debug('[puzzler] reorganizeGroupAfterBreakLink completed', {
            components: components.length,
          });
        } catch (e) {}

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
      // Show slots when:
      // 1. snappingPointsVisible is explicitly true, or
      // 2. when there's an active selection, or
      // 3. when interactive placement session is in progress, or
      // 4. when dragging (if snapping is enabled)
      const shouldShow =
        this.snappingPointsVisible ||
        (this.selectedObjects && this.selectedObjects.length > 0) ||
        (this._activePlacementSession &&
          this._activePlacementSession.state === 'placing') ||
        (this.isDragging && this.snappingEnabled);

      const scene = (this as any)[$scene];
      const camera = scene.getCamera
        ? scene.getCamera()
        : (scene as any).camera;
      if (!camera) return;

      const targetObject = this.findTargetObject();
      if (!targetObject) return;

      if (!shouldShow) {
        this.clearSlots(this._snappingPointSlots);
        return;
      }

      // Use HTML slots for all snapping points (both placed objects and placeholders)
      const snappingPointsFound: any[] = [];
      if (targetObject) {
        targetObject.traverse((child: any) => {
          // Show slots for all objects with snapping points
          if (child.userData?.snappingPoints) {
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
                data: {
                  object: child,
                  snapPoint,
                  index,
                },
              });
            });
          }
        });
      }

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

      // Allow selection of either the group object itself, or a child of
      // the group. Also accept older-style groups (isGroup) as well as
      // the newer isSnappedGroup marker. Normalize to the actual group
      // object that contains snapConnections.
      let selectedGroup: Object3D | null = null;
      if (this.selectedObjects.length > 0) {
        const sel = this.selectedObjects[0];
        // If the selected object is the snapped-group itself
        if (sel?.userData?.isSnappedGroup) {
          selectedGroup = sel;
        } else {
          // Try to find an enclosing snapped group first
          selectedGroup = getSnappedGroup(sel as any);
          // If not found, try walking up to an older-style group marker
          if (!selectedGroup) {
            let node = sel as Object3D | null;
            while (node) {
              if (node.userData?.isSnappedGroup === true) {
                selectedGroup = node;
                break;
              }
              node = node.parent as Object3D | null;
            }
          }
        }
      }

      if (!selectedGroup || !selectedGroup.userData?.snapConnections) {
        this._breakLinkSlots.forEach((slot) => {
          slot.style.display = 'none';
        });
        return;
      }

      const slotItems = selectedGroup.userData.snapConnections
        .map((snapConnection: any, index: number) => {
          const connectionId = `connection-${index}`;

          // Support multiple connection shapes:
          // - New: { object1, object2, snapPoint1, snapPoint2 }
          // - Old: { a: <name>, b: <name>, aPoint, bPoint }
          let obj1: Object3D | null = null;
          let obj2: Object3D | null = null;
          let sp1: any = null;
          let sp2: any = null;

          if (snapConnection.object1 && snapConnection.object2) {
            obj1 = snapConnection.object1;
            obj2 = snapConnection.object2;
            sp1 = snapConnection.snapPoint1;
            sp2 = snapConnection.snapPoint2;
          } else if (snapConnection.a || snapConnection.b) {
            // Resolve by name within the group first, then fallback to scene
            const nameA = snapConnection.a;
            const nameB = snapConnection.b;
            if (nameA) {
              obj1 = selectedGroup.getObjectByName(nameA) as Object3D | null;
              if (!obj1) obj1 = (this as any)[$scene].getObjectByName(nameA);
            }
            if (nameB) {
              obj2 = selectedGroup.getObjectByName(nameB) as Object3D | null;
              if (!obj2) obj2 = (this as any)[$scene].getObjectByName(nameB);
            }
            sp1 = snapConnection.aPoint;
            sp2 = snapConnection.bPoint;
          }

          if (!obj1 || !obj2 || !sp1 || !sp2) return null;

          const point1WorldPos = getSnappingPointWorldPosition(obj1, sp1);
          const point2WorldPos = getSnappingPointWorldPosition(obj2, sp2);

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
      // Only handle puzzler mouse interactions when edit-mode is active.
      if (!this.editMode) return;
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
      // Only handle puzzler mouse interactions when edit-mode is active.
      if (!this.editMode) return;

      this.updateMousePosition(event as any);

      if (this.isDragging && this.selectedObjects.length) {
        this.updateDragPosition();
      }
    }

    private onMouseUp(event: MouseEvent) {
      // Only handle puzzler mouse interactions when edit-mode is active.
      if (!this.editMode) return;

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
      // Only handle puzzler touch interactions when edit-mode is active.
      if (!this.editMode) return;
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
      // Only handle puzzler touch interactions when edit-mode is active.
      if (!this.editMode) return;
      if (event.touches.length === 1 && this.isDragging) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);
        this.updateDragPosition();
        event.preventDefault();
      }
    }

    private onTouchEnd(event: TouchEvent) {
      // Only handle puzzler touch interactions when edit-mode is active.
      if (!this.editMode) return;
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

      // Collect only objects explicitly marked as placed
      const partCandidates: Object3D[] = [];
      targetObject.traverse((child: any) => {
        if (child && child.userData && child.userData.isPlacedObject === true) {
          partCandidates.push(child);
        }
      });

      if (partCandidates.length === 0) return null;

      const intersects = this.raycaster.intersectObjects(partCandidates, true);
      if (intersects.length > 0) {
        let selectedPart = intersects[0].object as any;
        // Climb to the nearest ancestor that is marked as a placed object
        while (
          selectedPart &&
          selectedPart.parent &&
          selectedPart.userData?.isPlacedObject !== true
        ) {
          selectedPart = selectedPart.parent;
        }
        if (selectedPart && selectedPart.userData?.isPlacedObject === true)
          return selectedPart;
      }
      return null;
    }

    private startDragging(_event?: MouseEvent | TouchEvent) {
      if (!this.selectedObjects.length) return;

      // Determine drag target based on selection scope:
      // - 'part': drag the selected object directly (don't look for enclosing group)
      // - 'group': drag the enclosing group so grouped objects move together
      if (this.selectionScope === 'part') {
        this._currentDragTarget = this.selectedObjects[0];
      } else {
        this._currentDragTarget =
          this._findEnclosingGroup(this.selectedObjects[0]) ||
          this.selectedObjects[0];
      }

      this.isDragging = true;
      this.dragStartMousePosition.copy(this.currentMousePosition);
      try {
        this.dragStartPosition.copy(this._currentDragTarget.position);
      } catch (e) {
        this.dragStartPosition.copy(this.selectedObjects[0].position);
      }

      this.raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      if (this.originalFloorY !== undefined) {
        this.floorPlane.constant = -this.originalFloorY;
      }

      const clickPoint = new Vector3();
      if (this.raycaster.ray.intersectPlane(this.floorPlane, clickPoint)) {
        const offsetTarget = this._currentDragTarget || this.selectedObjects[0];
        this.dragOffset.set(
          offsetTarget.position.x - clickPoint.x,
          0,
          offsetTarget.position.z - clickPoint.z
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

      // Show all snapping points during drag if snapping is enabled
      if (this.snappingEnabled) {
        this.toggleSnappingPoints(true);
      }

      try {
        this.updateSnappingPointSlots();
      } catch (e) {}

      this.requestShadowUpdate();
    }

    private updateDragPosition() {
      if (!this.isDragging || this.selectedObjects.length === 0) return;

      this.raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      const object = this._currentDragTarget || this.selectedObjects[0];

      const intersectionPoint = new Vector3();
      if (
        this.raycaster.ray.intersectPlane(this.floorPlane, intersectionPoint)
      ) {
        const desiredX = intersectionPoint.x + this.dragOffset.x;
        const desiredZ = intersectionPoint.z + this.dragOffset.z;
        const desiredY =
          object.userData?.isSnappedGroup === true
            ? object.position.y
            : this.originalFloorY || 0;

        object.position.set(desiredX, desiredY, desiredZ);
        try {
          console.debug('[puzzler] updateDragPosition', {
            target: object.name || object.uuid,
            pos: { x: desiredX, y: desiredY, z: desiredZ },
            dragTarget:
              this._currentDragTarget?.name || this._currentDragTarget?.uuid,
          });
        } catch (e) {}

        // clear any previous pending connection and then check again
        this._setPendingSnapConnection(null);
        try {
          // debug removed
        } catch (e) {}
        if (this.snappingEnabled) {
          this.checkAndApplySnapping(object, intersectionPoint);
        }

        this.requestShadowUpdate();
        this[$needsRender]();
        try {
          this.updateSnappingPointSlots();
        } catch (e) {}
      }
    }

    private stopDragging() {
      if (!this.isDragging) return;

      this.isDragging = false;

      // Ensure dragged individual parts maintain their placement status
      if (this.selectionScope === 'part' && this._currentDragTarget) {
        try {
          // If we dragged an individual part, ensure it's properly parented and marked as placed
          const draggedObject = this._currentDragTarget;
          if (draggedObject && !draggedObject.userData?.isSnappedGroup) {
            // Ensure it's marked as a placed object for selection
            draggedObject.userData = draggedObject.userData || {};
            draggedObject.userData.isPlacedObject = true;

            // Only re-parent to scene if the object is NOT part of a group
            // Re-parenting objects that are part of groups breaks the group structure
            const isPartOfGroup =
              draggedObject.parent?.userData?.isSnappedGroup === true;

            if (!isPartOfGroup) {
              // Ensure it's properly parented to the scene
              const scene = (this as any)[$scene];
              if (
                scene &&
                draggedObject.parent !== scene.target &&
                draggedObject.parent !== scene
              ) {
                try {
                  if (draggedObject.parent)
                    draggedObject.parent.remove(draggedObject);
                  scene.target
                    ? scene.target.add(draggedObject)
                    : scene.add(draggedObject);
                } catch (e) {
                  console.debug('[puzzler] failed to re-parent dragged part', {
                    e,
                  });
                }
              }
            }
          }
        } catch (e) {
          console.debug('[puzzler] error ensuring part placement status', {
            e,
          });
        }
      }

      // Clear recently disconnected pairs when drag ends - allow normal snapping again
      this._recentlyDisconnectedPairs.clear();

      this._currentDragTarget = null;

      if (this.pendingSnapConnection) {
        try {
          this.completeSnapConnection(this.pendingSnapConnection);
        } catch (e) {}
        this.pendingSnapConnection = null;
      }

      // update shadows/bbox after drag ends / reparenting done
      this.requestShadowUpdate();

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
      if (draggedObject.userData?.isSnappedGroup === true) {
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
            // Check if this pair was recently disconnected (for hysteresis)
            const draggedId = snappableObj.name || snappableObj.uuid;
            const targetId = child.name || child.uuid;
            const pairKey = [draggedId, targetId].sort().join('|');
            const wasRecentlyDisconnected =
              this._recentlyDisconnectedPairs.has(pairKey);

            // Use larger distance threshold for recently disconnected pairs
            const effectiveSnapDistance = wasRecentlyDisconnected
              ? this.snapDistance * this.snapHysteresis
              : this.snapDistance;

            try {
              console.debug('[puzzler] checking snap with hysteresis', {
                draggedId,
                targetId,
                pairKey,
                wasRecentlyDisconnected,
                normalDistance: this.snapDistance,
                effectiveDistance: effectiveSnapDistance,
              });
            } catch (e) {}

            const connections = findSnappingConnections(snappableObj, child);

            try {
              console.debug('[puzzler] connections found', {
                draggedId,
                targetId,
                pairKey,
                connectionsFound: connections.length,
                closestDistance:
                  connections.length > 0 ? connections[0].distance : 'none',
              });
            } catch (e) {}

            // Apply hysteresis filtering: completely disable snapping for recently disconnected pairs during drag
            let filteredConnections = wasRecentlyDisconnected
              ? [] // Block all snapping for recently disconnected pairs during drag
              : connections;

            try {
              console.debug('[puzzler] after filtering', {
                draggedId,
                targetId,
                pairKey,
                wasRecentlyDisconnected,
                originalConnections: connections.length,
                filteredConnections: filteredConnections.length,
                effectiveSnapDistance,
              });
            } catch (e) {}

            if (filteredConnections && filteredConnections.length > 0) {
              try {
                // debug removed
              } catch (e) {}
              // Record candidate connections for debug overlay
              // debug pair accumulation removed

              try {
                // debug removed
              } catch (e) {}

              const closest = filteredConnections[0];
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

        // Normalize the selected group: accept selecting either the group
        // itself or a child and resolve to the canonical `isSnappedGroup`.
        let selectedGroup: Object3D | null = this.selectedObjects[0];
        if (!selectedGroup?.userData?.isSnappedGroup) {
          selectedGroup =
            getSnappedGroup(selectedGroup as any) || selectedGroup;
        }
        if (!selectedGroup?.userData?.isSnappedGroup) return;

        try {
          console.debug('[puzzler] breakSpecificConnection selectedGroup', {
            name: selectedGroup.name || selectedGroup.uuid,
            userData: selectedGroup.userData,
            connectionId,
          });
        } catch (e) {}

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

        // Track this specific disconnection for hysteresis logic
        try {
          let id1: string | undefined, id2: string | undefined;
          if (connectionToBreak.object1 && connectionToBreak.object2) {
            id1 =
              connectionToBreak.object1.name || connectionToBreak.object1.uuid;
            id2 =
              connectionToBreak.object2.name || connectionToBreak.object2.uuid;
          } else if (connectionToBreak.a && connectionToBreak.b) {
            id1 = connectionToBreak.a;
            id2 = connectionToBreak.b;
          } else {
            // Try to extract from the group's children
            const groupChildren = [...selectedGroup.children];
            if (groupChildren.length >= 2) {
              id1 = groupChildren[0].name || groupChildren[0].uuid;
              id2 = groupChildren[1].name || groupChildren[1].uuid;
            }
          }

          if (id1 && id2) {
            const pairKey = [id1, id2].sort().join('|');
            this._recentlyDisconnectedPairs.add(pairKey);

            try {
              console.debug(
                '[puzzler] tracking broken connection pair for hysteresis',
                {
                  id1,
                  id2,
                  pairKey,
                }
              );
            } catch (e) {}
          }
        } catch (e) {}

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
            try {
              console.debug(
                '[puzzler] breakSpecificConnection: no connections remain — ungrouping',
                {
                  group: selectedGroup.name || selectedGroup.uuid,
                }
              );
            } catch (e) {}

            const ungrouped = this.ungroupSnappedGroup(selectedGroup);
            try {
              console.debug('[puzzler] ungroupSnappedGroup result', {
                ungrouped,
              });
            } catch (e) {}

            // Clear break link slots immediately and hide them
            try {
              this.clearSlots(this._breakLinkSlots);
              this._breakLinkSlotsVisible = false;
            } catch (e) {}

            // Clear selection/outline and refresh slots so UI reflects the change
            try {
              (this as any)[$clearSelectedObject]();
            } catch (e) {}
            try {
              this.selectedObjects = [];
            } catch (e) {}
            try {
              this._setOutline([]);
            } catch (e) {}
            try {
              this.updateOutlineSelection();
            } catch (e) {}
            try {
              this.updateSnappingPointSlots();
            } catch (e) {}
            try {
              this.updateBreakLinkSlots();
            } catch (e) {}
            (this as any)[$needsRender]();
          } catch (e) {
            try {
              console.debug('[puzzler] ungroup error', { e });
            } catch (e) {}
          }
          return;
        }

        // Defensive cleanup: reparent any child that is not referenced by
        // any remaining connection so it becomes independently movable.
        try {
          const remainingNames = new Set<string>();
          connections.forEach((c: any) => {
            if (c.a || c.b) {
              if (c.a) remainingNames.add(c.a);
              if (c.b) remainingNames.add(c.b);
            } else if (c.object1 && c.object2) {
              const na = c.object1?.name || String(c.object1?.id);
              const nb = c.object2?.name || String(c.object2?.id);
              if (na) remainingNames.add(na);
              if (nb) remainingNames.add(nb);
            }
          });

          const parent = selectedGroup.parent;
          const children = [...selectedGroup.children];
          children.forEach((child) => {
            const childName = child.name || String(child.id);
            if (!remainingNames.has(childName)) {
              // detach singleton child and clear group metadata
              try {
                selectedGroup.remove(child);
                if (parent) parent.add(child);
                if (child.userData) {
                  delete child.userData.groupId;
                  delete child.userData.isInGroup;
                }
              } catch (e) {}
            }
          });

          // If group empty after cleanup remove it
          if (selectedGroup.children.length === 0 && selectedGroup.parent)
            selectedGroup.parent.remove(selectedGroup);
        } catch (e) {
          try {
            console.debug('[puzzler] post-break cleanup failed', { e });
          } catch (e) {}
        }

        // Otherwise, reorganize the group into connected components and
        // clear selection so children may be selected/moved individually.
        try {
          this.reorganizeGroupAfterBreakLink(selectedGroup, connectionToBreak);
        } catch (e) {}

        // Clear selection and outline so no stale group selection remains
        try {
          try {
            (this as any)[$clearSelectedObject]();
          } catch (e) {}
          try {
            this.selectedObjects = [];
          } catch (e) {}
          try {
            this._setOutline([]);
          } catch (e) {}
          try {
            this.updateOutlineSelection();
          } catch (e) {}
        } catch (e) {}

        // Refresh slots so the UI reflects the reorganization immediately
        try {
          this.updateBreakLinkSlots();
        } catch (e) {}
        try {
          this.updateSnappingPointSlots();
        } catch (e) {}

        // Debug: log final parent/userData for former children to help diagnose
        try {
          const parentObj = selectedGroup.parent as Object3D | null;
          const children = parentObj
            ? [...(parentObj as Object3D).children]
            : [];
          console.debug('[puzzler] post-break selectedGroup children', {
            parent: parentObj?.name || parentObj?.uuid,
            children: children
              .filter((c) => c.name && c.name.startsWith('part__'))
              .map((c) => ({
                name: c.name,
                parent: c.parent?.name,
                userData: c.userData,
              })),
          });
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
      void this._snappingPointSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._breakLinkSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._rotationSlots;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      void this._recentlyDisconnectedPairs;
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

    // Higher-level API functions for external control

    /**
     * Get the currently selected node based on selection scope
     */
    getSelectedObject() {
      return this.selectedObjects.length > 0 ? this.selectedObjects[0] : null;
    }

    /**
     * Select a specific part (regardless of current selection scope)
     */
    selectPart(node: Object3D): boolean {
      if (!node) return false;
      try {
        this.selectedObjects = [node];
        (this as any)[$selectObjectForControls](node);
        const meshes = this._getMeshesForOutline(node);
        this._setOutline(meshes);

        // Hide break link slots for individual parts
        this._breakLinkSlotsVisible = false;
        this.clearSlots(this._breakLinkSlots);

        this.updateSnappingPointSlots();
        this.updateBreakLinkSlots();
        this.dispatchEvent(
          new CustomEvent('select', {
            detail: { node, type: 'part' },
          })
        );
        return true;
      } catch (e) {
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
        this.selectedObjects = [node];
        (this as any)[$selectObjectForControls](node);
        const meshes = this._getMeshesForOutline(node);
        this._setOutline(meshes);
        this.updateSnappingPointSlots();
        this.dispatchEvent(
          new CustomEvent('select', {
            detail: { node, type: 'group' },
          })
        );
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Clear current selection
     */
    clearSelection(): void {
      try {
        (this as any)[$clearSelectedObject]();
        this.selectedObjects = [];
        this._setOutline([]);
        this._breakLinkSlotsVisible = false;
        this.clearSlots(this._breakLinkSlots);
        this.updateSnappingPointSlots();
        this.updateBreakLinkSlots();
        this.dispatchEvent(
          new CustomEvent('select', {
            detail: { node: null, type: 'clear' },
          })
        );
      } catch (e) {}
    }

    /**
     * Delete a specific node
     */
    deleteNode(node: Object3D): boolean {
      if (!node) return false;
      try {
        // Fire events for individual parts before deletion
        this._firePartsStateEvents(node, 'delete', {});

        if (node.parent) {
          node.parent.remove(node);
        }

        // Clear selection if this was the selected node
        if (this.selectedObjects.includes(node)) {
          this.clearSelection();
        }

        (this as any)[$needsRender]();
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Remove an object by name. Optionally animate its scale down before
     * removing. Uses tick-driven scale animations when `options.animate` is true.
     */
    removeObject(objectName: string, options?: { animate?: boolean }) {
      try {
        if (!objectName) return;
        const scene = (this as any)[$scene];
        const obj = scene.getObjectByName(objectName) as Object3D | null;
        if (!obj) return;

        // Find enclosing snapped group (if any)
        const group = this._findEnclosingGroup(obj);

        // Deselect logic
        if (group) {
          // If the group is selected, clear selection
          if (
            this.selectedObjects.length > 0 &&
            this.selectedObjects[0] === group
          ) {
            this.clearSelection();
          }
        } else {
          // If the object itself is selected, clear selection
          if (this.selectedObjects.includes(obj)) {
            this.clearSelection();
          }
        }

        // Break connections in group metadata so the group no longer references this object
        if (
          group &&
          group.userData &&
          Array.isArray(group.userData.snapConnections)
        ) {
          const name = obj.name || String(obj.id);
          group.userData.snapConnections =
            group.userData.snapConnections.filter((c: any) => {
              try {
                if (c.a || c.b) {
                  return c.a !== name && c.b !== name;
                }
                if (c.object1 && c.object2) {
                  const n1 = c.object1?.name || String(c.object1?.id);
                  const n2 = c.object2?.name || String(c.object2?.id);
                  return n1 !== name && n2 !== name;
                }
                if (c.objectA && c.objectB) {
                  const n1 = c.objectA?.name || String(c.objectA?.id);
                  const n2 = c.objectB?.name || String(c.objectB?.id);
                  return n1 !== name && n2 !== name;
                }
              } catch (e) {}
              return true;
            });
          try {
            this.updateGroupMeshCache(group);
          } catch (e) {}
        }

        const doRemoveNow = () => {
          try {
            // Clear any lingering in-group metadata
            try {
              if (obj.userData) {
                delete obj.userData.groupId;
                delete obj.userData.isInGroup;
              }
            } catch (e) {}

            if (obj.parent) obj.parent.remove(obj);
            this[$needsRender]();
          } catch (e) {}
        };

        // Animated removal
        if (options?.animate) {
          try {
            const start = obj.scale.clone();
            const end = new Vector3(0, 0, 0);
            this._scaleAnimationMap.set(
              obj,
              createScaleAnimation(start, end, (_o: Object3D) => {
                // After scale-out, remove the object and ensure group metadata cleaned
                doRemoveNow();
              })
            );
            this.requestShadowUpdate();
            this[$needsRender]();
            return;
          } catch (e) {
            // fallback to immediate removal below
          }
        }

        // Immediate removal
        doRemoveNow();
      } catch (e) {
        // swallow
      }
    }

    /**
     * Group selected objects together (creates a new group from multiple objects)
     */
    groupSelectedObjects(): Object3D | null {
      if (this.selectedObjects.length < 2) return null;

      try {
        // Create new group
        const group = new Object3D();
        group.name = `user_group_${Date.now()}`;
        group.userData = group.userData || {};
        group.userData.isSnappedGroup = true;
        group.userData.snapConnections = [];

        const parent = this.selectedObjects[0].parent;
        if (parent) parent.add(group);

        // Move all selected objects to the group while preserving world transforms
        this.selectedObjects.forEach((obj) => {
          obj.updateMatrixWorld(true);
          const worldPos = new Vector3();
          const worldQuat = obj.quaternion.clone();
          const worldScale = new Vector3();
          obj.getWorldPosition(worldPos);
          obj.getWorldScale(worldScale);

          if (obj.parent) obj.parent.remove(obj);
          group.add(obj);

          // Convert world transform to local transform in new parent
          if (obj.parent) {
            const localPos = obj.parent.worldToLocal(worldPos.clone());
            obj.position.copy(localPos);
            obj.quaternion.copy(worldQuat);
            obj.scale.copy(worldScale);
          }

          obj.userData = obj.userData || {};
          obj.userData.isInGroup = true;
        });

        this.selectGroup(group);
        this._firePartsStateEvents(group, 'group', {});

        (this as any)[$needsRender]();
        return group;
      } catch (e) {
        return null;
      }
    }

    /**
     * Break all connections in a group (free all parts)
     */
    breakGroup(group: Object3D): boolean {
      if (!group || !group.userData?.isSnappedGroup) return false;
      return this.ungroupSnappedGroup(group);
    }

    /**
     * Break a specific connection between two parts in a group
     */
    breakLink(connectionId: string): boolean {
      try {
        this.breakSpecificConnection(connectionId);
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Fire events for individual parts when group operations occur
     */
    private _firePartsStateEvents(
      node: Object3D,
      operation: string,
      data: any
    ): void {
      try {
        if (node.userData?.isSnappedGroup || node.name === 'PuzzlerRoot') {
          // This is a group - fire events for each child part
          node.traverse((child) => {
            if (
              child !== node &&
              (child.userData?.isPlacedObject || child.name === 'PuzzlerRoot')
            ) {
              this.dispatchEvent(
                new CustomEvent('part-state-change', {
                  detail: {
                    node: child,
                    operation,
                    groupNode: node,
                    data: {
                      ...data,
                      position: child.position.clone(),
                      rotation: child.rotation.clone(),
                      scale: child.scale.clone(),
                    },
                  },
                })
              );
            }
          });
        } else {
          // Single part
          this.dispatchEvent(
            new CustomEvent('part-state-change', {
              detail: {
                node,
                operation,
                groupNode: null,
                data: {
                  ...data,
                  position: node.position.clone(),
                  rotation: node.rotation.clone(),
                  scale: node.scale.clone(),
                },
              },
            })
          );
        }
      } catch (e) {}
    }

    /**
     * Start an interactive placement session using a low-resolution GLB as a
     * placeholder. Returns a PlacementSession (EventTarget-style).
     * Only one interactive session may be 'placing' at a time; if one exists
     * it will be returned instead of creating a new one.
     */
    beginPlacement(
      lowResSrc?: string,
      highResSrc?: string,
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

      // Ensure snapping slots are refreshed immediately when an interactive
      // placement session is started so snapping points for the placeholder
      // will appear (placeholder may not yet be loaded).
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}

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

    /**
     * Replace an existing placed object with a new GLB model, preserving its
     * position, transforms, grouping, and optionally merging userData.parts.
     *
     * @param objectUuid - The UUID of the object to replace
     * @param src - Optional direct URL to the replacement GLB
     * @param options - Optional PlacementOptions, including getHighResUrl callback
     * @returns Promise that resolves when replacement is complete
     */
    async replacePart(
      objectUuid: string,
      src?: string,
      options?: PlacementOptions
    ): Promise<void> {
      if (!objectUuid) {
        throw new Error('objectUuid is required');
      }

      const scene = (this as any)[$scene];
      if (!scene) {
        throw new Error('Scene not available');
      }

      // Find the object to replace by UUID using Three.js built-in method
      const objectToReplace = scene.getObjectByProperty('uuid', objectUuid) as
        | Object3D
        | undefined;

      if (!objectToReplace) {
        throw new Error(`Object with UUID "${objectUuid}" not found`);
      }

      // Resolve the URL: use src parameter or call getHighResUrl callback
      let srcToLoad = src;
      if (!srcToLoad && options?.getHighResUrl) {
        try {
          srcToLoad = await options.getHighResUrl();
        } catch (error) {
          throw new Error(
            `Failed to resolve URL via getHighResUrl: ${getErrorMessage(error)}`
          );
        }
      }

      if (!srcToLoad) {
        throw new Error(
          'No URL provided: src parameter or options.getHighResUrl is required'
        );
      }

      // Save the original object's transform, parent, and metadata
      const originalParent = objectToReplace.parent;
      const originalPosition = objectToReplace.position.clone();
      const originalQuaternion = objectToReplace.quaternion.clone();
      const originalScale = objectToReplace.scale.clone();
      const originalUserData = { ...objectToReplace.userData };
      const originalName = objectToReplace.name;

      // Load the new GLB
      const loader = (this as any)[$renderer].loader;
      let gltf: GLTF;
      try {
        gltf = await loader.load(srcToLoad, this, (p: number) => {
          // Emit progress events
          try {
            this.dispatchEvent(
              new CustomEvent('progress', {
                detail: {
                  totalProgress: p,
                  reason: 'replace-part',
                  objectUuid,
                },
              })
            );
          } catch (e) {
            // ignore
          }
        });
      } catch (error) {
        throw new Error(
          `Failed to load replacement GLB from "${srcToLoad}": ${getErrorMessage(
            error
          )}`
        );
      }

      if (!gltf || !gltf.scene) {
        throw new Error('Loaded GLTF missing scene');
      }

      const newObject = gltf.scene;

      // Apply the original transform to the new object
      newObject.position.copy(originalPosition);
      newObject.quaternion.copy(originalQuaternion);
      newObject.scale.copy(originalScale);

      // Restore name
      newObject.name = originalName;

      // Merge userData: start with original, then apply new options
      newObject.userData = {
        ...originalUserData,
        ...newObject.userData,
      };

      // If options.part is provided, merge it with existing userData.part
      if (options?.part) {
        try {
          if (originalUserData.part) {
            // Merge the parts objects
            newObject.userData.part = {
              ...originalUserData.part,
              ...options.part,
            };
          } else {
            newObject.userData.part = options.part;
          }
        } catch (e) {
          // If merge fails, just use the new part
          newObject.userData.part = options.part;
        }
      }

      // Apply other options if provided
      if (options?.id !== undefined) {
        newObject.userData.id = options.id;
      }
      if (options?.name !== undefined) {
        newObject.userData.name = options.name;
        newObject.name = options.name;
      }
      if (options?.mass !== undefined) {
        newObject.userData.mass = options.mass;
      }
      if (options?.selectable !== undefined) {
        newObject.userData.selectable = options.selectable;
      }
      if (options?.editable !== undefined) {
        newObject.userData.editable = options.editable;
      }
      if (options?.snappingPoints) {
        newObject.userData.snappingPoints = options.snappingPoints;
      }

      // Check if the target object is part of a group
      const parentGroup = this._findEnclosingGroup(objectToReplace);

      // Remove the old object from its parent
      if (originalParent) {
        originalParent.remove(objectToReplace);
      }

      // Add the new object to the same parent
      if (originalParent) {
        originalParent.add(newObject);
      } else {
        // Fallback: add to scene target
        try {
          scene.target.add(newObject);
        } catch (e) {
          scene.add(newObject);
        }
      }

      // If the object was in a group, update any snap connections that reference it
      if (parentGroup && parentGroup.userData?.snapConnections) {
        try {
          const connections = parentGroup.userData.snapConnections;
          connections.forEach((connection: any) => {
            // Update connections that reference the old object
            if (connection.a === originalName) {
              connection.a = newObject.name;
            }
            if (connection.b === originalName) {
              connection.b = newObject.name;
            }
            if (connection.object1 === objectToReplace) {
              connection.object1 = newObject;
            }
            if (connection.object2 === objectToReplace) {
              connection.object2 = newObject;
            }
            if (connection.objectA === objectToReplace) {
              connection.objectA = newObject;
            }
            if (connection.objectB === objectToReplace) {
              connection.objectB = newObject;
            }
          });

          // Update group mesh cache
          this.updateGroupMeshCache(parentGroup);
        } catch (e) {
          // Ignore errors updating group metadata
        }
      }

      // Update selection if the replaced object was selected
      try {
        const wasSelected =
          this.selectedObjects &&
          this.selectedObjects.some((obj) => obj.uuid === objectUuid);
        if (wasSelected) {
          this.selectedObjects = this.selectedObjects.map((obj) =>
            obj.uuid === objectUuid ? newObject : obj
          );
          // Update outline
          this.updateOutlineSelection();
        }
      } catch (e) {
        // Ignore selection update errors
      }

      // Request shadow update and render
      this.requestShadowUpdate();
      this[$needsRender]();

      // Emit completion event
      try {
        this.dispatchEvent(
          new CustomEvent('replace-part-complete', {
            detail: {
              objectUuid,
              oldObject: objectToReplace,
              newObject,
            },
          })
        );
      } catch (e) {
        // ignore
      }
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
  private _lowResSrc: string | undefined;
  private _highResSrc: string | undefined;
  private _options?: PlacementOptions;

  constructor(
    element: any,
    lowResSrc?: string,
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
      // Resolve low-res URL: use callback if no direct URL provided
      let lowResUrl = this._lowResSrc;
      if (!lowResUrl && this._options?.getLowResUrl) {
        lowResUrl = await this._options.getLowResUrl();
      }

      if (!lowResUrl) {
        throw new Error('No low-res URL provided and no getLowResUrl callback');
      }

      const loader = (this._element as any)[$renderer].loader;
      const gltf = await loader.load(lowResUrl, this._element, (p: number) => {
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
      });

      if (!gltf || !gltf.scene) return;

      // Use the low-res model as the interactive placeholder
      const placeholder = gltf.scene;
      if (!placeholder) return;

      this.placeholder = placeholder;
      placeholder.name = this._options?.name
        ? this._options.name + `_${+new Date()}`
        : this.id;

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
        new CustomEvent('error', {
          detail: {
            type: 'placementfailure',
            sessionId: this.id,
            sourceError: error,
          },
        })
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

      this.placeholder.position.set(world.x, 0, world.z);

      // Check for snapping during interactive placement if snapping is enabled
      if (
        (this._element as any).snappingEnabled &&
        this.placeholder &&
        this.placeholder.userData.snappingPoints
      ) {
        try {
          const targetObject = (this._element as any).findTargetObject();
          if (targetObject) {
            // Find potential snap targets by traversing all placed objects
            let bestConnection: any = null;
            targetObject.traverse((child: any) => {
              if (
                child.userData.isPlacedObject &&
                child !== this.placeholder &&
                child.userData.snappingPoints
              ) {
                const connections = findSnappingConnections(
                  this.placeholder!,
                  child
                );
                if (connections && connections.length > 0) {
                  const connection = {
                    ...connections[0],
                    targetObject: child,
                  };
                  if (
                    !bestConnection ||
                    connection.distance < bestConnection.distance
                  ) {
                    bestConnection = connection;
                  }
                }
              }
            });

            if (bestConnection) {
              // Apply temporary snapping for visual feedback
              const draggedWorld = getSnappingPointWorldPosition(
                this.placeholder!,
                bestConnection.draggedPoint
              );
              const targetWorld = getSnappingPointWorldPosition(
                bestConnection.targetObject,
                bestConnection.targetPoint
              );
              const offset = new Vector3().subVectors(
                targetWorld,
                draggedWorld
              );
              this.placeholder.position.add(offset);

              // Record pending connection for commit
              (this._element as any).pendingSnapConnection = {
                draggedObject: this.placeholder!,
                targetObject: bestConnection.targetObject,
                draggedPoint: bestConnection.draggedPoint,
                targetPoint: bestConnection.targetPoint,
              };
            } else {
              // Clear any pending connection if no snap found
              (this._element as any).pendingSnapConnection = null;
            }
          }
        } catch (e) {
          // Ignore snapping errors during placement
        }
      }

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
        new CustomEvent('error', {
          detail: {
            type: 'placementfailure',
            sessionId: this.id,
            sourceError: error,
          },
        })
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

    console.log('[puzzler] PlacementSession.commit: loading final model', {
      finalSrc,
      highResSrc: this._highResSrc,
      getHighResUrl: this._options?.getHighResUrl,
      sessionId: this.id,
    });

    // Resolve high-res URL: use callback if no direct URL provided
    let srcToLoad = finalSrc || this._highResSrc;
    console.log('[puzzler] PlacementSession.commit: resolved finalSrc', {
      srcToLoad,
    });
    if (!srcToLoad && this._options?.getHighResUrl) {
      console.log(
        '[puzzler] PlacementSession.commit: invoking getHighResUrl callback'
      );
      try {
        srcToLoad = await this._options.getHighResUrl();
      } catch (e) {
        console.error(
          '[puzzler] PlacementSession.commit: getHighResUrl callback failed',
          e
        );
        this.dispatchEvent(
          new CustomEvent('error', {
            detail: {
              type: 'placementfailure',
              sessionId: this.id,
              sourceError: e,
            },
          })
        );
        this._endInteractive();
        return;
      }
    }

    if (!srcToLoad) {
      const error = new Error(
        'No high-res URL provided and no getHighResUrl callback'
      );
      console.error('[puzzler] PlacementSession.commit: no high-res URL', {
        sessionId: this.id,
      });
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: {
            type: 'placementfailure',
            sessionId: this.id,
            sourceError: error,
          },
        })
      );
      this._endInteractive();
      return;
    }

    this.dispatchEvent(
      new CustomEvent('loading-start', {
        detail: {
          sessionId: this.id,
          src: srcToLoad,
          center: centerDetail,
        },
      })
    );

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
        gltf.scene.name = this.placeholder.name;
      } else {
        gltf.scene.name = this._options?.name
          ? this._options.name + `_${+new Date()}`
          : this.id;
      }

      // Mark as placed so selection logic recognizes it
      gltf.scene.userData = {
        ...gltf.scene.userData,
        id: this._options?.id || this.id,
        name: this._options?.name || this.id,
        part: this._options?.part,
      };
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
        new CustomEvent('error', {
          detail: {
            type: 'placementfailure',
            sessionId: this.id,
            sourceError: error,
          },
        })
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
