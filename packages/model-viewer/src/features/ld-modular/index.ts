import { property } from 'lit/decorators.js';
import {
  Object3D,
  Vector3,
  Box3,
  Vector2,
  Plane,
  Quaternion,
  EulerOrder,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
} from 'three';
import type { Part } from '@london-dynamics/types/product';

import { Constructor } from '../../utilities.js';
import { SelectionChangeDetail } from '../ld-selection/index.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $renderer,
  $tick,
  $userInputElement,
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
  clearExplosionFragments,
  createExplosionFragments,
  createQuatAnimation,
  stepExplosionFragments,
  stepQuatAnimations,
} from '../../utilities/animation.js';
import { LogFunction, WarnFunction, ErrorFunction } from '../ld-debug.js';

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

export type PlacementGraphNode = {
  name: string;
  uuid: string;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
  part: Partial<Part> | undefined;
  snappingPoints?: SnappingPoint[];
  children?: PlacementGraphNode[];
};

export type BulkPlacementItem = {
  id: string;
  part?: Partial<Part>;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
};

type ImmediatePlacementTransform = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

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
  /**
   * How to interpret relative rotation values (e.g. "+90", "-=45"):
   * - undefined / 'relative': add or subtract the value from the current rotation (default).
   * - 'snapToClosest': snap to the nearest multiple: add → next multiple, subtract → previous multiple.
   *    E.g. current 80, "+90" → 90; current 80, "-90" → 0.
   */
  mode?: 'relative' | 'snapToClosest';
};

export declare interface LDModularInterface {
  load: LoadFunction;
  loadMany: LoadManyFunction;
  attachObject: AttachFunction;
  attachMaterial: AttachMaterialFunction;
  clear: ClearSceneFunction;
  disableBaseModelShadows: boolean;

  toggleBaseModelVisibility(state?: boolean): void;

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
  ) => PlacementSession;

  placeGlb: (
    highResSrc?: string,
    options?: PlacementOptions & ImmediatePlacementTransform
  ) => Promise<{ id: string; node: Object3D }>;

  placeManyGlb: (
    items: BulkPlacementItem[],
    options?: {
      concurrency?: number;
      getHighResUrl?: (item: BulkPlacementItem) => Promise<string | undefined>;
    }
  ) => Promise<Array<{ id: string; node: Object3D }>>;

  replacePart: (
    objectUuid: string,
    src?: string,
    options?: PlacementOptions
  ) => Promise<void>;

  getPlacementTree(): PlacementGraphNode[];

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

export const LDModularMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDModularInterface> & T => {
  // LDSelectionMixin is now applied in the main mixin composition chain,
  // so we inherit selection functionality without reapplying it
  class LDModularModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'edit' })
    editMode: boolean = false;

    @property({ type: Number, attribute: 'snap-distance' })
    snapDistance: number = 0.2; // Default snap distance in meters

    @property({ type: Number, attribute: 'snap-hysteresis' })
    snapHysteresis: number = 1.5; // Multiplier for unsnap distance (prevents immediate re-snapping)

    @property({ type: Boolean, attribute: 'snapping-enabled' })
    snappingEnabled: boolean = false;

    @property({ type: Boolean, attribute: 'snapping-points-visible' })
    snappingPointsVisible: boolean = false;

    @property({ type: Boolean, attribute: 'disable-base-model-shadows' })
    disableBaseModelShadows: boolean = false;

    // Store bound event handler reference
    private _boundSelectionChangeHandler: ((event: Event) => void) | null =
      null;

    connectedCallback() {
      super.connectedCallback();

      // Use inline arrow function wrapper for event listener
      this.addEventListener('selection-change', (event: Event) => {
        this._onSelectionChangeForPuzzler(event);
      });

      // Setup drag handlers for puzzler
      try {
        this.setupDragHandlers();
      } catch (e) {}
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.cancelRequestedShadowUpdate();

      // Clean up event listener
      if (this._boundSelectionChangeHandler) {
        this.removeEventListener(
          'selection-change',
          this._boundSelectionChangeHandler as EventListener
        );
        this._boundSelectionChangeHandler = null;
      }

      this.teardownDragHandlers();
      // Clear selected object state when removed
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
      } catch (e) {}
      try {
        // Clear selected groups bookkeeping
        (this as any)._selectedGroups.clear();
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

      // Clean up explosion fragments
      try {
        clearExplosionFragments(this[$scene]);
      } catch (e) {}
    }

    async placeGlb(
      highResSrc?: string,
      options?: PlacementOptions & ImmediatePlacementTransform
    ): Promise<{ id: string; node: Object3D }> {
      const element: any = this;
      const session = new PlacementSession(
        this,
        (this as any).log,
        (this as any).warn,
        (this as any).error,
        undefined,
        highResSrc,
        options
      );

      // If explicit transforms are provided, prefer using a placeholder so the
      // final model can simply copy its local transform from it. First try a
      // bounds-based placeholder from part.bounds; if that is not available,
      // fall back to an empty Object3D that just carries the desired transform.
      if (options) {
        const scene = (element as any)[$scene];
        if (scene) {
          let placeholder: Object3D | null = null;

          if (options.part) {
            placeholder = (session as any)._createPlaceholderFromBounds(
              scene,
              element
            ) as Object3D | null;
          }

          if (!placeholder && (options.position || options.rotation || options.scale)) {
            placeholder = new Object3D();
            placeholder.name = options.name
              ? options.name + `_${+new Date()}`
              : session.id;
            placeholder.userData = {
              selectable: true,
              ...(placeholder.userData || {}),
              isPlacementPlaceholder: true,
            };
            try {
              scene.target.add(placeholder);
            } catch (e) {
              scene.add(placeholder);
            }
          }

          if (placeholder) {
            session.placeholder = placeholder;
            if (options.position) {
              placeholder.position.set(
                options.position[0],
                options.position[1],
                options.position[2]
              );
            }
            if (options.rotation) {
              placeholder.rotation.set(
                (options.rotation[0] * Math.PI) / 180,
                (options.rotation[1] * Math.PI) / 180,
                (options.rotation[2] * Math.PI) / 180
              );
            }
            if (options.scale) {
              placeholder.scale.set(
                options.scale[0],
                options.scale[1],
                options.scale[2]
              );
            }
          }
        }
      }

      // Compute center detail from explicit position (if provided)
      let centerDetail: { x: number; y: number; z: number } | null = null;
      if (options?.position) {
        centerDetail = {
          x: options.position[0],
          y: options.position[1],
          z: options.position[2],
        };
      }

      (this as any).dispatchEvent(
        new CustomEvent('loading-start', {
          detail: {
            sessionId: session.id,
            src: highResSrc,
            center: centerDetail,
          },
        })
      );

      return (session as any)._placeFinalGlb(this, highResSrc || '');
    }

    async placeManyGlb(
      items: BulkPlacementItem[],
      options?: {
        concurrency?: number;
        getHighResUrl?: (item: BulkPlacementItem) => Promise<string | undefined>;
      }
    ): Promise<Array<{ id: string; node: Object3D }>> {
      const total = items.length;
      if (total === 0) return [];

      const results: Array<{ id: string; node: Object3D }> = new Array(total);
      const concurrency = Math.max(1, options?.concurrency ?? 4);

      let nextIndex = 0;
      let completed = 0;

      const runNext = async (): Promise<void> => {
        const currentIndex = nextIndex++;
        if (currentIndex >= total) {
          return;
        }

        const item = items[currentIndex];

        try {
          let highResSrc: string | undefined;
          if (options?.getHighResUrl) {
            highResSrc = await options.getHighResUrl(item);
          }

          const transform = item.transform || {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          };

          const placementOptions: PlacementOptions & ImmediatePlacementTransform =
            {
              ...(item.part ? { part: item.part } : {}),
              id: item.id,
              name: item.part?.name || item.id,
              position: transform.position,
              rotation: transform.rotation,
              scale: transform.scale,
            };

          const placed = await this.placeGlb(highResSrc, placementOptions);
          results[currentIndex] = { id: item.id, node: placed.node };
        } finally {
          completed++;
          const totalProgress = total ? completed / total : 1;
          try {
            (this as any).dispatchEvent(
              new CustomEvent('progress', {
                detail: {
                  totalProgress,
                  reason: 'bulk-placement',
                  completed,
                  total,
                },
              })
            );
          } catch (e) {}

          await runNext();
        }
      };

      const workers: Promise<void>[] = [];
      const workerCount = Math.min(concurrency, total);
      for (let i = 0; i < workerCount; i++) {
        workers.push(runNext());
      }

      await Promise.all(workers);

      try {
        (this as any).dispatchEvent(
          new CustomEvent('bulk-placement-complete', {
            detail: {
              total,
              completed,
              results,
            },
          })
        );
      } catch (e) {}

      return results;
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
          ((this as any).selectedObjects &&
            (this as any).selectedObjects.length > 0) ||
          (this._activePlacementSession &&
            this._activePlacementSession.state === 'placing') ||
          ((this as any).isDragging && this.snappingEnabled);

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
        // Step registered quaternion animations (delta is in ms)
        const rotBefore = this._rotationAnimationMap.size;
        stepQuatAnimations(this._rotationAnimationMap, delta);
        const rotAfter = this._rotationAnimationMap.size;

        const explosionsUpdated = stepExplosionFragments((this as any)[$scene]);

        if (rotBefore > 0 || rotAfter > 0 || explosionsUpdated) {
          this.requestShadowUpdate();
          (this as any)[$needsRender]();
        }
      } catch (e) {}

      // Process any pending shadow update requested via requestShadowUpdate()
      try {
        if (this._shadowUpdatePending) {
          this._shadowUpdatePending = false;
          const scene = (this as any)[$scene];
          if (scene?.shadow) scene.shadow.needsUpdate = true;
          // Ensure a render is requested so shadow maps get re-rendered.
          (this as any)[$needsRender]();
        }
      } catch (e) {}
    }

    async setSrcFromBuffer(buffer: ArrayBuffer) {
      try {
        const safeObjectUrl = createSafeObjectUrlFromArrayBuffer(buffer);

        (this as any).setAttribute('src', safeObjectUrl.url);
      } catch (e) {
        console.error(e);
      }
    }

    toggleBaseModelVisibility(visible?: boolean): void {
      const scene = this[$scene];

      // Find base model
      let baseModel: Object3D | undefined;
      scene.traverse((object) => {
        if (object?.userData?.isBaseModel) {
          baseModel = object;
        }
      });

      if (!baseModel) return;

      const newVisibility =
        typeof visible === 'boolean' ? visible : !baseModel.visible;

      // Toggle visibility and shadow casting on base model
      baseModel.traverse((child) => {
        // Store original castShadow state if not already stored
        if (child.userData.originalCastShadow === undefined) {
          child.userData.originalCastShadow =
            (child as any).castShadow ?? false;
        }

        child.visible = newVisibility;

        // Disable shadow casting when hidden, restore when visible
        if (newVisibility) {
          (child as any).castShadow = child.userData.originalCastShadow;
        } else {
          (child as any).castShadow = false;
        }
      });

      // Queue shadow re-render with updated visibility
      if (scene.shadow) {
        scene.shadow.needsUpdate = true;
      }

      (this as any)[$needsRender]();
    }

    private _puzzleRegistry: Map<string, GLTF> = new Map();

    private _currentObject: Object3D | undefined = undefined;

    // Track in-progress rotation animations so they can be stepped from [$tick]
    // Map<Object3D, QuatAnimation>
    private _rotationAnimationMap: Map<Object3D, any> = new Map();

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

            (this as any).dispatchEvent(
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

    getPlacementTree() {
      const scene = this[$scene];
      const results: PlacementGraphNode[] = [];

      function extractData(obj: Object3D): PlacementGraphNode {
        const isGroup = !!obj.userData?.isSnappedGroup;
        return {
          name: obj.name,
          uuid: obj.uuid,
          position: obj.position.clone(),
          rotation: obj.rotation.clone(),
          scale: obj.scale.clone(),
          part: obj.userData?.part,
          snappingPoints: obj.userData?.snappingPoints,
          ...(isGroup && {
            children: obj.children.map((child) => extractData(child)),
          }),
        };
      }

      const root = scene.target || scene;
      // First, collect all group objects and their children
      const groupChildren = new Set<string>();
      root.traverse((obj: Object3D) => {
        if (obj.userData?.isSnappedGroup) {
          obj.children.forEach((child) => {
            groupChildren.add(child.uuid);
          });
        }
      });

      root.traverse((obj: Object3D) => {
        if (obj.userData?.isSnappedGroup) {
          // Add group itself
          results.push(extractData(obj));
        } else if (
          obj.userData?.isPlacedObject &&
          !groupChildren.has(obj.uuid)
        ) {
          // Add placed object only if not part of a group
          results.push(extractData(obj));
        }
      });

      return results;
    }

    attachObject(id: string, target?: string, options?: PositionOptions) {
      (this as any).log(
        'attachObject',
        id,
        'to',
        target,
        'with options',
        options
      );
    }

    detachObject(id: string) {
      (this as any).log('detachObject', id);
    }

    attachMaterial(id: string) {
      (this as any).log('attachMaterial', id);
    }

    clear() {}

    // private [$updateFramingThrottled] = throttle(async () => {
    //   await (this as any)[$scene].updateFraming();
    //   (this as any)[$needsRender]();
    // }, 400);

    setRotation(
      name: string,
      value: [number | string, number | string, number | string],
      options?: RotationOptions
    ) {
      const { order = 'XYZ', animate = false, mode } = options || {};

      // Accept absolute numeric degrees (e.g. 45, -90) or relative strings
      // with "=": "+=90" (add 90), "-=45" (subtract 45). Plain "-90" sets to -90.
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
          'Invalid value array. Expected an array of three numbers (absolute degrees) or strings like "+=90" / "-=45" for relative changes.'
        );
      }

      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }

      if (!this._currentObject) {
        this._currentObject = (this as any)[$scene].getObjectByName(name);
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
        // Relative syntax: "+=90", "-=45" (requires =). Plain "-90" or "90" are absolute.
        const relMatch = s.match(/^([+-])=\s*([+-]?\d+(?:\.\d+)?)$/);
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

      if (
        animate &&
        hasRelative &&
        allAbsoluteMatchCurrent &&
        mode !== 'snapToClosest'
      ) {
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
        // relative inputs, absolute for absolute inputs; or snap-to-closest when mode is set).
        const finalDegs: [number, number, number] = [0, 1, 2].map((i) => {
          if (!parsed[i].isRelative) return parsed[i].absolute ?? current[i];
          const delta = parsed[i].delta!;
          if (mode === 'snapToClosest') {
            const step = Math.abs(delta);
            if (step === 0) return current[i];
            const ratio = current[i] / step;
            const nearestInt = Math.round(ratio);
            const eps = 1e-6;
            // If we're already (within epsilon) at an exact multiple, move one step
            // in the direction of the delta; otherwise snap toward the next/previous
            // multiple in the sign direction.
            if (Math.abs(ratio - nearestInt) < eps) {
              return current[i] + (delta > 0 ? step : -step);
            }
            return delta > 0
              ? Math.ceil(ratio) * step
              : Math.floor(ratio) * step;
          }
          return current[i] + delta;
        }) as [number, number, number];

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
        (this as any)[$needsRender]();
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
        (this as any)[$needsRender]();
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
        (this as any)[$needsRender]();
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
        this._currentObject = (this as any)[$scene].getObjectByName(name);
      }

      if (!this._currentObject) return;

      const obj = this._currentObject as Object3D;
      try {
        obj.position.set(value[0], value[1], value[2]);
      } catch (e) {
        // ignore invalid sets
      }

      this.requestShadowUpdate();
      (this as any)[$needsRender]();
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
        this._currentObject = (this as any)[$scene].getObjectByName(name);
      }

      if (!this._currentObject) return;

      const obj = this._currentObject as Object3D;
      try {
        obj.scale.set(value[0], value[1], value[2]);
      } catch (e) {
        // ignore invalid sets (e.g., zero/NaN)
      }

      this.requestShadowUpdate();
      (this as any)[$needsRender]();
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
        this._currentObject = (this as any)[$scene].getObjectByName(name);
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
        this._currentObject = (this as any)[$scene].getObjectByName(name);
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
        this._currentObject = (this as any)[$scene].getObjectByName(name);
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

    private _shadowUpdatePending: boolean = false;

    private requestShadowUpdate() {
      // Schedule a shadow update for the next tick. We set a pending flag
      // which is processed from [$tick] — this avoids using raw
      // requestAnimationFrame and allows the update to be driven by the
      // same tick loop the rest of the mixin uses.
      if (this._shadowUpdatePending) return;
      this._shadowUpdatePending = true;
      // Ask the render loop to run; the pending flag will be handled in [$tick]
      (this as any)[$needsRender]();
    }

    private cancelRequestedShadowUpdate() {
      // Clear any pending shadow update request. The pending flag is
      // observed and processed from [$tick].
      this._shadowUpdatePending = false;
    }

    private _activePlacementSession: PlacementSession | null = null;

    // Selection change handler to react to selection changes from the selection mixin
    private _onSelectionChangeForPuzzler(event: Event) {
      const customEvent = event as CustomEvent<SelectionChangeDetail>;
      const { selectedObjects, type } = customEvent.detail;

      // Update snapping point slots when selection changes
      try {
        this.updateSnappingPointSlots();
      } catch (e) {
        (this as any).error('[puzzler] Failed to update snapping points:', e);
      }

      // Update floating control strip when exactly one object is selected
      if (type === 'select' && selectedObjects.length === 1) {
        const selected = selectedObjects[0];
        try {
          // Access symbol methods via any cast (they're available via the mixin chain)
          const selectFn = (this as any)[$selectObjectForControls];
          if (typeof selectFn === 'function') {
            selectFn.call(this, selected);
          } else {
            (this as any).warn(
              '[puzzler] $selectObjectForControls not available'
            );
          }
        } catch (e) {
          (this as any).error(
            '[puzzler] Failed to select object for controls:',
            e
          );
        }
      } else {
        try {
          const clearFn = (this as any)[$clearSelectedObject];
          if (typeof clearFn === 'function') {
            clearFn.call(this);
          } else {
            (this as any).warn('[puzzler] $clearSelectedObject not available');
          }
        } catch (e) {
          (this as any).error('[puzzler] Failed to clear selected object:', e);
        }
      }

      // Update break-link slots when a group is selected
      if (type === 'select' && selectedObjects.length > 0) {
        const selected = selectedObjects[0];
        if (selected.userData?.isSnappedGroup) {
          this._breakLinkSlotsVisible = true;
          try {
            this.updateBreakLinkSlots();
          } catch (e) {
            (this as any).error(
              '[puzzler] Failed to update break-link slots:',
              e
            );
          }
        } else {
          this._breakLinkSlotsVisible = false;
          this.clearSlots(this._breakLinkSlots);
        }
      } else {
        this._breakLinkSlotsVisible = false;
        this.clearSlots(this._breakLinkSlots);
      }

      (this as any)[$needsRender]();
    }

    // When dragging, prefer to move the enclosing group (if any).
    private _currentDragTarget: Object3D | null = null;

    /** Set when we disabled camera on pointer down over a selectable; re-enable on pointer up. */
    private _cameraDisabledForPointer: boolean = false;

    /** True = pointer went down on selectable, false = on empty (camera drag). Don't disable on move during camera drag. */
    private _pointerDownOnSelectable: boolean | null = null;

    private _onPointerDownCaptureBound!: (e: PointerEvent) => void;
    private _onPointerUpCaptureBound!: (e: PointerEvent) => void;
    private _onPointerMoveCaptureBound!: (e: PointerEvent) => void;

    /** Throttle pointermove raycast to one per frame for large scenes. */
    private _pointerMoveOverSelectableRaf: number = 0;
    private _pendingPointerMove: { clientX: number; clientY: number } | null =
      null;

    /** Window listener for pointerup during drag so release is always received (e.g. over floating strip). */
    private _windowPointerUpForDragBound?: (e: PointerEvent) => void;

    // Slot maps for UI (snapping points, break-link/ungroup)
    private _snappingPointSlots: Map<string, HTMLElement> = new Map();
    // (snapping-debug related debug slots removed)
    private _breakLinkSlots: Map<string, HTMLElement> = new Map();
    private _breakLinkSlotsVisible: boolean = false;

    // Drag / snapping runtime state (ported)
    // Note: isDragging is inherited from parent selection mixin
    // private isDragging: boolean = false;
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
            (this as any)._findEnclosingGroup(prev.draggedObject) ||
            prev.draggedObject;
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
        (this as any).log('[puzzler] _setPendingSnapConnection ->', v);
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
          const mover =
            (this as any)._findEnclosingGroup(draggedObj) || draggedObj;

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
              (this as any).log(
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

    // Re-declare protected inherited property for TypeScript visibility
    protected currentMousePosition!: Vector2;
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
      if ((this as any).selectedObjects.length !== 1) return false;
      const group = (this as any).selectedObjects[0];
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
            (this as any).log(
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

        (this as any)[$needsRender]();
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
        const g1 = (this as any)._findEnclosingGroup(draggedObject);
        const g2 = (this as any)._findEnclosingGroup(targetObject);

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

          // Calculate the center point of the two objects in the parent's coordinate space
          // Since both objects are children of the same parent, use their local positions
          const groupPosition = new Vector3()
            .addVectors(draggedObject.position, targetObject.position)
            .multiplyScalar(0.5);

          parent.add(group);
          group.position.copy(groupPosition);

          // Update the group's matrix so attach works correctly for children
          group.updateMatrixWorld(true);

          [draggedObject, targetObject].forEach((obj: any) => {
            // Use attach() instead of add() to preserve world transform
            // attach() automatically converts the object's position to be relative to the group
            obj.updateMatrixWorld(true);
            group.attach(obj);
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
          (this as any)[$needsRender]();
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

    private mergeSnappedGroups(
      group1: Object3D,
      group2: Object3D,
      connection: any
    ) {
      // Move children from group2 into group1 and merge connections
      try {
        try {
          (this as any).log('[puzzler] mergeSnappedGroups', {
            g1: group1.name || group1.uuid,
            g2: group2.name || group2.uuid,
            connection,
          });
        } catch (e) {}
        const children = [...group2.children];
        children.forEach((child) => {
          // Use attach() to preserve world transform when moving to new group
          child.updateMatrixWorld(true);
          group1.attach(child);
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
        (this as any)[$needsRender]();
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
          (this as any).log('[puzzler] addObjectToSnappedGroup', {
            group: group.name || group.uuid,
            newObject: newObject.name || newObject.uuid,
            connection,
          });
        } catch (e) {}
        // Use attach() to preserve world transform when reparenting
        newObject.updateMatrixWorld(true);
        group.attach(newObject);
        newObject.userData = newObject.userData || {};
        newObject.userData.groupId = group.name;
        newObject.userData.isInGroup = true;
        group.userData = group.userData || {};
        group.userData.snapConnections = group.userData.snapConnections || [];
        group.userData.snapConnections.push(connection);
        this.updateGroupMeshCache(group);
        (this as any)[$needsRender]();
        // ensure callers receive the updated group
        return group;
      } catch (e) {}
      return null;
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
        focusGroup = snappedGroup;
      }

      if (focusGroup) {
        const boundingBox = new Box3().setFromObject(focusGroup);
        const center = boundingBox.getCenter(new Vector3());
        try {
          (this as any)[$scene].setTarget(center.x, center.y, center.z);
        } catch (e) {}
        try {
          (this as any).log('[puzzler] completeSnapConnection focusGroup', {
            name: focusGroup.name || focusGroup.uuid,
            userData: focusGroup.userData,
          });
        } catch (e) {}
      }

      // Ensure selection reflects the focused group (if any) so UI knows
      // which group we're operating on.
      if (focusGroup) {
        try {
          // Use _selectObject to properly update selection including highlighting
          (this as any)._selectObject(focusGroup);
        } catch (e) {}
      }

      try {
        (this as any).log('[puzzler] selection after completeSnapConnection', {
          selected:
            (this as any).selectedObjects[0]?.name ||
            (this as any).selectedObjects[0]?.uuid,
          userData: (this as any).selectedObjects[0]?.userData,
        });
      } catch (e) {}

      // Show break link slots if the selected object is a snapped/group
      if (
        (this as any).selectedObjects.length > 0 &&
        (this as any).selectedObjects[0].userData?.isSnappedGroup
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
          (this as any).log('[puzzler] reorganizeGroupAfterBreakLink', {
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
            (this as any).log(
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
            comp.forEach((obj: any) => {
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
          (this as any).log(
            '[puzzler] reorganizeGroupAfterBreakLink completed',
            {
              components: components.length,
            }
          );
        } catch (e) {}

        (this as any)[$needsRender]();
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
        ((this as any).selectedObjects &&
          (this as any).selectedObjects.length > 0) ||
        (this._activePlacementSession &&
          this._activePlacementSession.state === 'placing') ||
        ((this as any).isDragging && this.snappingEnabled);

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
        owner: this as any,
        container:
          ((this as any).shadowRoot?.querySelector(
            '.slot.ld-modular'
          ) as HTMLElement) || null,
        scene: (this as any)[$scene],
        camera,
        onCreate: (_item: any) => {
          const element = createSlotElement(
            'ld-snapping-point',
            '',
            'snapping-point',
            (this as any).shadowRoot,
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
      if (
        !this._breakLinkSlotsVisible ||
        (this as any).selectedObjects.length === 0
      ) {
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
      if ((this as any).selectedObjects.length > 0) {
        const sel = (this as any).selectedObjects[0];
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
        owner: this as any,
        container:
          ((this as any).shadowRoot?.querySelector(
            '.slot.ld-modular'
          ) as HTMLElement) || null,
        scene,
        camera,
        onCreate: (item: any) => {
          const element = createSlotElement(
            'ld-break-link',
            '',
            'break-link',
            (this as any).shadowRoot,
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

    /**
     * Returns true if the given client position is over a selectable object.
     * Used to disable camera on pointer down when in editMode so the camera does not orbit.
     * Uses the same input element as camera controls for rect so coordinates match.
     */
    private _isPointerOverSelectableObject(
      clientX: number,
      clientY: number
    ): boolean {
      const inputEl = (this as any)[$userInputElement];
      if (!inputEl) return false;
      const rect = inputEl.getBoundingClientRect();
      const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      (this as any).currentMousePosition.set(mouseX, mouseY);

      const scene = (this as any)[$scene];
      if (!scene) return false;
      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return false;

      (this as any).raycaster.setFromCamera(
        (this as any).currentMousePosition,
        camera
      );
      const targetObject = (this as any)._findTargetObject();
      if (!targetObject) return false;

      const allPlacedObjects: Object3D[] = [];
      targetObject.traverse((child: any) => {
        if (child.userData?.isPlacedObject === true)
          allPlacedObjects.push(child);
      });
      const objectsToRaycast =
        allPlacedObjects.length > 0 ? allPlacedObjects : [targetObject];

      const allIntersects = (this as any).raycaster.intersectObjects(
        objectsToRaycast,
        true
      );
      const intersects = allIntersects.filter(
        (hit: any) =>
          hit.object.visible &&
          !hit.object.userData?.noHit &&
          hit.object.userData?.selectable !== false
      );
      if (intersects.length === 0) return false;

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

      let objectToSelect: Object3D | null = null;
      const scope = (this as any).selectionScope;
      if (scope === 'part') {
        if (
          hasPlacedObjects &&
          intersectedObject?.userData?.isPlacedObject === true
        ) {
          objectToSelect = intersectedObject;
        } else {
          objectToSelect = intersectedObject;
        }
      } else if (scope === 'group') {
        if (
          hasPlacedObjects &&
          intersectedObject?.userData?.isPlacedObject === true
        ) {
          objectToSelect =
            (this as any)._findEnclosingGroup(intersectedObject) ||
            intersectedObject;
        } else {
          objectToSelect = intersectedObject?.parent?.name
            ? intersectedObject.parent
            : intersectedObject;
        }
      } else {
        objectToSelect = intersectedObject;
      }
      return (
        objectToSelect != null &&
        (this as any)._isNodeSelectable(objectToSelect)
      );
    }

    // Drag / touch handlers and utilities (ported/adapted)
    private setupDragHandlers() {
      (this as any).addEventListener('mousedown', this.onMouseDown.bind(this));
      (this as any).addEventListener('mousemove', this.onMouseMove.bind(this));
      (this as any).addEventListener('mouseup', this.onMouseUp.bind(this));

      (this as any).addEventListener(
        'touchstart',
        this.onTouchStart.bind(this)
      );
      (this as any).addEventListener('touchmove', this.onTouchMove.bind(this));
      (this as any).addEventListener('touchend', this.onTouchEnd.bind(this));

      // When editMode is on, keep camera disabled while pointer is over a selectable object
      // so click/drag doesn't orbit. We disable on pointermove (over selectable) so we're
      // already disabled before pointerdown, since CameraControls registers before us.
      const inputEl = (this as any)[$userInputElement];
      this._onPointerDownCaptureBound = this._onPointerDownCapture.bind(this);
      this._onPointerUpCaptureBound = this._onPointerUpCapture.bind(this);
      this._onPointerMoveCaptureBound = this._onPointerMoveCapture.bind(this);
      if (inputEl) {
        inputEl.addEventListener(
          'pointerdown',
          this._onPointerDownCaptureBound,
          true
        );
        inputEl.addEventListener(
          'pointerup',
          this._onPointerUpCaptureBound,
          true
        );
        inputEl.addEventListener(
          'pointercancel',
          this._onPointerUpCaptureBound,
          true
        );
        inputEl.addEventListener(
          'pointermove',
          this._onPointerMoveCaptureBound,
          true
        );
      }

      // Prevent context menu during drag
      (this as any).addEventListener('contextmenu', (e: Event) =>
        e.preventDefault()
      );
    }

    private teardownDragHandlers() {
      try {
        (this as any).removeEventListener(
          'mousedown',
          this.onMouseDown.bind(this)
        );
        (this as any).removeEventListener(
          'mousemove',
          this.onMouseMove.bind(this)
        );
        (this as any).removeEventListener('mouseup', this.onMouseUp.bind(this));
        (this as any).removeEventListener(
          'touchstart',
          this.onTouchStart.bind(this)
        );
        (this as any).removeEventListener(
          'touchmove',
          this.onTouchMove.bind(this)
        );
        (this as any).removeEventListener(
          'touchend',
          this.onTouchEnd.bind(this)
        );
        const inputEl = (this as any)[$userInputElement];
        if (inputEl) {
          if (this._onPointerDownCaptureBound) {
            inputEl.removeEventListener(
              'pointerdown',
              this._onPointerDownCaptureBound,
              true
            );
          }
          if (this._onPointerUpCaptureBound) {
            inputEl.removeEventListener(
              'pointerup',
              this._onPointerUpCaptureBound,
              true
            );
            inputEl.removeEventListener(
              'pointercancel',
              this._onPointerUpCaptureBound,
              true
            );
          }
          if (this._onPointerMoveCaptureBound) {
            inputEl.removeEventListener(
              'pointermove',
              this._onPointerMoveCaptureBound,
              true
            );
          }
        }
        if (this._pointerMoveOverSelectableRaf !== 0) {
          cancelAnimationFrame(this._pointerMoveOverSelectableRaf);
          this._pointerMoveOverSelectableRaf = 0;
        }
        this._pendingPointerMove = null;
        this._removeWindowDragListeners();
      } catch (e) {}
    }

    /**
     * Disable camera when pointer moves over a selectable (so we're disabled before pointerdown).
     * Re-enable when pointer leaves selectable and we're not dragging.
     * Do not disable when user is dragging the camera (pointer went down on empty space).
     * Throttled to one raycast per frame for performance in large scenes.
     */
    private _onPointerMoveCapture(e: PointerEvent) {
      if (!this.editMode || !(this as any)[$controls]) return;
      if ((this as any).isDragging) return;
      if (this._pointerDownOnSelectable === false) return;

      this._pendingPointerMove = { clientX: e.clientX, clientY: e.clientY };
      if (this._pointerMoveOverSelectableRaf !== 0) return;

      this._pointerMoveOverSelectableRaf = requestAnimationFrame(() => {
        this._pointerMoveOverSelectableRaf = 0;
        const p = this._pendingPointerMove;
        this._pendingPointerMove = null;
        if (!p || !this.editMode || !(this as any)[$controls]) return;
        if ((this as any).isDragging) return;
        if (this._pointerDownOnSelectable === false) return;

        const overSelectable = this._isPointerOverSelectableObject(
          p.clientX,
          p.clientY
        );
        try {
          if (overSelectable) {
            (this as any)[$controls].disableInteraction?.();
            this._cameraDisabledForPointer = true;
          } else if (this._cameraDisabledForPointer) {
            (this as any)[$controls].enableInteraction?.();
            this._cameraDisabledForPointer = false;
          }
        } catch (_) {}
      });
    }

    private _onPointerDownCapture(e: PointerEvent) {
      if (!this.editMode || e.button !== 0) return;
      if ((this as any)._isUIElement(e.target)) return;
      if (!(this as any)[$controls]) return;
      const overSelectable = this._isPointerOverSelectableObject(
        e.clientX,
        e.clientY
      );
      this._pointerDownOnSelectable = overSelectable;
      if (!overSelectable) return;
      try {
        (this as any)[$controls].disableInteraction?.();
        this._cameraDisabledForPointer = true;
      } catch (_) {}
    }

    private _onPointerUpCapture(_e: PointerEvent) {
      this._pointerDownOnSelectable = null;
      if (!this._cameraDisabledForPointer) return;
      this._cameraDisabledForPointer = false;
      try {
        if ((this as any)[$controls]) {
          (this as any)[$controls].enableInteraction?.();
        }
      } catch (_) {}
    }

    private onMouseDown(event: MouseEvent) {
      // Only handle puzzler mouse interactions when edit-mode is active.
      if (!this.editMode) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      // Ignore clicks on UI elements
      if ((this as any)._isUIElement(event.target)) {
        return;
      }

      this.updateMousePosition(event as any);

      // Only start dragging if clicking on an already-selected object
      if ((this as any).selectedObjects.length) {
        const isOnSelectedObject = (this as any).selectedObjects.some(
          (obj: any) => this.isPointOnObject(this.currentMousePosition, obj)
        );
        if (isOnSelectedObject) {
          event.stopImmediatePropagation();
          event.preventDefault();
          this.startDragging(event);
          return;
        }
      }

      // Don't stop propagation - let the selection mixin handle selection via click event
    }

    private onMouseMove(event: MouseEvent) {
      if (!this.editMode || !(this as any).isDragging) return;

      this.updateMousePosition(event as any);
      this.updateDragPosition();
    }

    private onMouseUp(_event: MouseEvent) {
      if (!this.editMode) return;

      if ((this as any).isDragging) {
        this.stopDragging();
      }
    }

    private onTouchStart(event: TouchEvent) {
      if (!this.editMode) return;

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);

        if ((this as any).selectedObjects.length) {
          const isOnSelectedObject = (this as any).selectedObjects.some(
            (obj: any) => this.isPointOnObject(this.currentMousePosition, obj)
          );
          if (isOnSelectedObject) {
            event.stopImmediatePropagation();
            event.preventDefault();
            this.startDragging();
          }
        }
      }
    }

    private onTouchMove(event: TouchEvent) {
      // Only handle puzzler touch interactions when edit-mode is active.
      if (!this.editMode) return;
      if (event.touches.length === 1 && (this as any).isDragging) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);
        this.updateDragPosition();
        event.preventDefault();
      }
    }

    private onTouchEnd(_event: TouchEvent) {
      if (!this.editMode) return;

      if ((this as any).isDragging) {
        this.stopDragging();
      }
    }

    protected updateMousePosition(event: { clientX: number; clientY: number }) {
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      this.currentMousePosition.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y = -(
        ((event.clientY - rect.top) / rect.height) * 2 -
        1
      );
    }

    private updateMousePositionFromTouch(touch: Touch) {
      const rect = (this as unknown as HTMLElement).getBoundingClientRect();
      this.currentMousePosition.x =
        ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      this.currentMousePosition.y = -(
        ((touch.clientY - rect.top) / rect.height) * 2 -
        1
      );
    }

    private isPointOnObject(mousePosition: Vector2, object: Object3D): boolean {
      (this as any).raycaster.setFromCamera(
        mousePosition,
        (this as any)[$scene].camera
      );
      const intersects = (this as any).raycaster.intersectObject(object, true);
      // Filter out objects marked as noHit (e.g., measurement lines)
      const validIntersects = intersects.filter(
        (hit: any) => hit.object.visible && !hit.object.userData?.noHit
      );
      return validIntersects.length > 0;
    }

    private startDragging(_event?: MouseEvent | TouchEvent) {
      if (!(this as any).selectedObjects.length) {
        return;
      }

      // Determine drag target based on selection scope:
      // - 'part': drag the selected object directly (don't look for enclosing group)
      // - 'group': drag the enclosing group so grouped objects move together
      if ((this as any).selectionScope === 'part') {
        this._currentDragTarget = (this as any).selectedObjects[0];
      } else {
        this._currentDragTarget =
          (this as any)._findEnclosingGroup((this as any).selectedObjects[0]) ||
          (this as any).selectedObjects[0];
      }

      (this as any).isDragging = true;
      this.dragStartMousePosition.copy(this.currentMousePosition);
      try {
        if (this._currentDragTarget) {
          this.dragStartPosition.copy(this._currentDragTarget.position);
        } else if ((this as any).selectedObjects?.[0]) {
          this.dragStartPosition.copy(
            (this as any).selectedObjects[0].position
          );
        }
      } catch (e) {
        if ((this as any).selectedObjects?.[0]) {
          this.dragStartPosition.copy(
            (this as any).selectedObjects[0].position
          );
        }
      }

      (this as any).raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      if (this.originalFloorY !== undefined) {
        this.floorPlane.constant = -this.originalFloorY;
      }

      const clickPoint = new Vector3();
      if (
        (this as any).raycaster.ray.intersectPlane(this.floorPlane, clickPoint)
      ) {
        const offsetTarget =
          this._currentDragTarget || (this as any).selectedObjects[0];
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

      (this as any).style.cursor = 'grabbing';

      // Listen for pointerup/cancel on window so we always get release (e.g. when cursor is over floating strip)
      this._windowPointerUpForDragBound =
        this._onWindowPointerUpForDrag.bind(this);
      window.addEventListener(
        'pointerup',
        this._windowPointerUpForDragBound,
        true
      );
      window.addEventListener(
        'pointercancel',
        this._windowPointerUpForDragBound,
        true
      );

      // Snapping points will be shown automatically during drag via updateSnappingPointSlots
      // (isDragging && snappingEnabled condition)
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}

      this.requestShadowUpdate();
    }

    /**
     * Handles pointerup/pointercancel on window during drag so we always end drag
     * even when the cursor is over the floating control strip or another overlay.
     * Prevents the event so a button under the cursor doesn't also receive a click.
     */
    private _onWindowPointerUpForDrag(e: PointerEvent) {
      if (!(this as any).isDragging) return;
      if (e.button !== 0) return;
      this._removeWindowDragListeners();
      this.stopDragging();
      e.preventDefault();
      e.stopPropagation();
    }

    private _removeWindowDragListeners() {
      if (!this._windowPointerUpForDragBound) return;
      window.removeEventListener(
        'pointerup',
        this._windowPointerUpForDragBound,
        true
      );
      window.removeEventListener(
        'pointercancel',
        this._windowPointerUpForDragBound,
        true
      );
    }

    private updateDragPosition() {
      if (
        !(this as any).isDragging ||
        (this as any).selectedObjects.length === 0
      )
        return;

      (this as any).raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      const object =
        this._currentDragTarget || (this as any).selectedObjects[0];

      const intersectionPoint = new Vector3();
      if (
        (this as any).raycaster.ray.intersectPlane(
          this.floorPlane,
          intersectionPoint
        )
      ) {
        const desiredX = intersectionPoint.x + this.dragOffset.x;
        const desiredZ = intersectionPoint.z + this.dragOffset.z;
        const desiredY =
          object.userData?.isSnappedGroup === true
            ? object.position.y
            : this.originalFloorY || 0;

        object.position.set(desiredX, desiredY, desiredZ);
        try {
          (this as any).log('[puzzler] updateDragPosition', {
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
        (this as any)[$needsRender]();
        try {
          this.updateSnappingPointSlots();
        } catch (e) {}

        // Dispatch event so other mixins (like measure) can update
        (this as any).dispatchEvent(
          new CustomEvent('object-drag', {
            detail: {
              object,
              position: object.position.clone(),
            },
            bubbles: true,
            composed: true,
          })
        );
      }
    }

    private stopDragging() {
      if (!(this as any).isDragging) {
        return;
      }

      this._removeWindowDragListeners();
      (this as any).isDragging = false;

      // Ensure dragged individual parts maintain their placement status
      if ((this as any).selectionScope === 'part' && this._currentDragTarget) {
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
                  (this as any).log(
                    '[puzzler] failed to re-parent dragged part',
                    {
                      e,
                    }
                  );
                }
              }
            }
          }
        } catch (e) {
          (this as any).log('[puzzler] error ensuring part placement status', {
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

      (this as any).style.cursor = '';
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
              (this as any).log('[puzzler] checking snap with hysteresis', {
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
              (this as any).log('[puzzler] connections found', {
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
              (this as any).log('[puzzler] after filtering', {
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
        if ((this as any).selectedObjects.length !== 1) return;

        // Normalize the selected group: accept selecting either the group
        // itself or a child and resolve to the canonical `isSnappedGroup`.
        let selectedGroup: Object3D | null = (this as any).selectedObjects[0];
        if (!selectedGroup?.userData?.isSnappedGroup) {
          selectedGroup =
            getSnappedGroup(selectedGroup as any) || selectedGroup;
        }
        if (!selectedGroup?.userData?.isSnappedGroup) return;

        try {
          (this as any).log('[puzzler] breakSpecificConnection selectedGroup', {
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
              (this as any).log(
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
              (this as any).log(
                '[puzzler] breakSpecificConnection: no connections remain — ungrouping',
                {
                  group: selectedGroup.name || selectedGroup.uuid,
                }
              );
            } catch (e) {}

            const ungrouped = this.ungroupSnappedGroup(selectedGroup);
            try {
              (this as any).log('[puzzler] ungroupSnappedGroup result', {
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
              (this as any).selectedObjects = [];
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
              (this as any).log('[puzzler] ungroup error', { e });
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
            (this as any).log('[puzzler] post-break cleanup failed', { e });
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
            (this as any).selectedObjects = [];
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
          (this as any).log('[puzzler] post-break selectedGroup children', {
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
    // Note: getSelectedObject() is inherited from LDSelectionMixin

    /**
     * Select a specific part (regardless of current selection scope)
     * Extends base selectPart with puzzler-specific visualization
     */
    selectPart(node: Object3D): boolean {
      if (!node) return false;

      // Call parent selection logic via type assertion
      const parentSelectPart = Object.getPrototypeOf(
        Object.getPrototypeOf(this)
      ).selectPart;
      const success = parentSelectPart
        ? parentSelectPart.call(this, node)
        : false;
      if (!success) return false;

      try {
        // Note: control strip, snapping points and break-link slots will be updated by _onSelectionChange handler
        return true;
      } catch (e) {
        (this as any).error('[puzzler] selectPart error:', e);
        return false;
      }
    }

    /**
     * Select a specific group (regardless of current selection scope)
     * Extends base selectGroup with puzzler-specific visualization
     */
    selectGroup(node: Object3D): boolean {
      if (!node) return false;
      if (!node.userData?.isSnappedGroup && node.name !== 'PuzzlerRoot')
        return false;

      // Call parent selection logic via type assertion
      const parentSelectGroup = Object.getPrototypeOf(
        Object.getPrototypeOf(this)
      ).selectGroup;
      const success = parentSelectGroup
        ? parentSelectGroup.call(this, node)
        : false;
      if (!success) return false;

      try {
        // Note: control strip, snapping points and break-link slots will be updated by _onSelectionChange handler
        return true;
      } catch (e) {
        (this as any).error('[puzzler] selectGroup error:', e);
        return false;
      }
    }

    /**
     * Clear current selection
     * Extends base clearSelection with puzzler-specific cleanup
     */
    clearSelection(): void {
      // Early return if nothing to clear
      if ((this as any).selectedObjects.length === 0) return;

      try {
        // Puzzler-specific: clear control strip
        (this as any)[$clearSelectedObject]();

        // Hide break link slots
        this._breakLinkSlotsVisible = false;
        this.clearSlots(this._breakLinkSlots);
      } catch (e) {
        (this as any).error('[puzzler] clearSelection error:', e);
      }

      // Parent selection mixin logic (inlined to avoid prototype chain issues)
      (this as any).selectedObjects = [];
      (this as any)._selectedGroups.clear();

      // Clear highlight if enabled
      if ((this as any).highlightSelected) {
        (this as any)._updateHighlight();
      }

      (this as any)._dispatchSelectionChange('clear');
      (this as any)[$needsRender]();

      // Note: snapping points and break-link slots will be updated by _onSelectionChange handler
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
        if ((this as any).selectedObjects.includes(node)) {
          (this as any).clearSelection();
        }

        (this as any)[$needsRender]();
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Remove an object by name. Optionally animate with a Star Fox-style explosion effect.
     * When `options.animate` is true, spawns tetrahedron fragments that fly outward while
     * rotating and scaling down, then removes the object.
     */
    removeObject(objectName: string, options?: { animate?: boolean }) {
      try {
        if (!objectName) return;
        const scene = (this as any)[$scene];
        const obj = scene.getObjectByName(objectName) as Object3D | null;
        if (!obj) return;

        // Find enclosing snapped group (if any)
        const group = (this as any)._findEnclosingGroup(obj);

        // Deselect logic
        if (group) {
          // If the group is selected, clear selection
          if (
            (this as any).selectedObjects.length > 0 &&
            (this as any).selectedObjects[0] === group
          ) {
            (this as any).clearSelection();
          }
        } else {
          // If the object itself is selected, clear selection
          if ((this as any).selectedObjects.includes(obj)) {
            (this as any).clearSelection();
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
            (this as any)[$needsRender]();
          } catch (e) {}
        };

        // Animated removal - Star Fox-style explosion
        if (options?.animate) {
          try {
            createExplosionFragments(obj, this[$scene], {
              onComplete: () => doRemoveNow(),
              setupComplete: () => {
                (this as any)[$needsRender]();
              },
            });
            // Immediately hide the original object
            obj.visible = false;
            this.requestShadowUpdate();
            (this as any)[$needsRender]();
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
      if ((this as any).selectedObjects.length < 2) return null;

      try {
        // Create new group
        const group = new Object3D();
        group.name = `user_group_${Date.now()}`;
        group.userData = group.userData || {};
        group.userData.isSnappedGroup = true;
        group.userData.snapConnections = [];

        const parent = (this as any).selectedObjects[0].parent;
        if (parent) parent.add(group);

        // Move all selected objects to the group while preserving world transforms
        (this as any).selectedObjects.forEach((obj: any) => {
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

        (this as any).selectGroup(group);
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
              (this as any).dispatchEvent(
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
          (this as any).dispatchEvent(
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
        (this as any).log,
        (this as any).warn,
        (this as any).error,
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

      // Track where the pointer was when placement started and max distance moved
      // (for distance-based fallback). Demo: drag starts on a button inside model-viewer.
      // Consuming app: drag starts outside. We use fallback only when the user barely
      // moved (click without drag); otherwise use current position.
      const DRAG_THRESHOLD_PX = 10;
      let placementStartClientX: number | null = initialMouse
        ? initialMouse.clientX
        : null;
      let placementStartClientY: number | null = initialMouse
        ? initialMouse.clientY
        : null;
      let maxDistanceSq = 0;
      let pointerCaptured = false;

      // Wire default pointer capture (window-level) so consumers don't need to
      // manage global listeners. Pointer moves update the placeholder; pointer
      // up commits the placement. ESC cancels.
      const onPointerMove = (e: PointerEvent) => {
        try {
          if (session.state === 'placing') {
            if (
              placementStartClientX === null ||
              placementStartClientY === null
            ) {
              placementStartClientX = e.clientX;
              placementStartClientY = e.clientY;
            }
            // Steal pointer capture on first move so we keep receiving events even
            // when drag started on a button (which may have captured the pointer).
            if (!pointerCaptured) {
              pointerCaptured = true;
              try {
                (this as any).setPointerCapture(e.pointerId);
              } catch (_) {}
            }
            if (
              placementStartClientX !== null &&
              placementStartClientY !== null
            ) {
              const dx = e.clientX - placementStartClientX;
              const dy = e.clientY - placementStartClientY;
              maxDistanceSq = Math.max(maxDistanceSq, dx * dx + dy * dy);
            }
            session.updatePosition(e.clientX, e.clientY);
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerUp = (e: PointerEvent) => {
        try {
          if (session.state === 'placing') {
            const releaseDistance =
              placementStartClientX !== null && placementStartClientY !== null
                ? Math.hypot(
                    e.clientX - placementStartClientX,
                    e.clientY - placementStartClientY
                  )
                : 0;
            // Use fallback only if they never moved more than threshold (use max
            // distance so we don't rely on release point alone; and if release is
            // far from start, treat as drag).
            const movedEnough =
              maxDistanceSq > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX ||
              releaseDistance > DRAG_THRESHOLD_PX;
            const useFallback = !movedEnough;
            if (useFallback) {
              session.applyFallbackCommitPosition();
            }
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
            // NOTE: Do NOT set ph.position here - updatePosition() already
            // calculated the correct local position with bbox adjustment
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
            (this as any).dispatchEvent(
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
      const parentGroup = (this as any)._findEnclosingGroup(objectToReplace);

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
          (this as any).selectedObjects &&
          (this as any).selectedObjects.some(
            (obj: any) => obj.uuid === objectUuid
          );
        if (wasSelected) {
          (this as any).selectedObjects = (this as any).selectedObjects.map(
            (obj: any) => (obj.uuid === objectUuid ? newObject : obj)
          );
        }
      } catch (e) {
        // Ignore selection update errors
      }

      // Request shadow update and render
      this.requestShadowUpdate();
      (this as any)[$needsRender]();

      // Emit completion event
      try {
        (this as any).dispatchEvent(
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

  return LDModularModelViewerElement as Constructor<LDModularInterface> & T;
};

/**
 * PlacementSession represents an interactive placement instance. It's an
 * EventTarget and emits events: 'start','update','loading-start','loaded','error','cancel'.
 */
class PlacementSession extends EventTarget {
  id: string;
  state: 'placing' | 'loading' | 'ended' | 'cancelled' = 'placing';
  placeholder: Object3D | null = null;
  private log: LogFunction;
  private warn?: WarnFunction;
  private error?: ErrorFunction;
  private _element: InstanceType<ReturnType<typeof LDModularMixin>> | null;
  private _lowResSrc: string | undefined;
  private _highResSrc: string | undefined;
  private _options?: PlacementOptions;
  private _lastCursorPosition: { x: number; y: number; z: number } | null =
    null;
  // Store the target position where the bottom-center of the bounding box should be
  private _targetBottomCenter: { x: number; y: number; z: number } | null =
    null;

  constructor(
    element: any,
    log: LogFunction,
    warn?: WarnFunction,
    error?: ErrorFunction,
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
    this.log = log;
    this.warn = warn;
    this.error = error;
    (this as any).dispatchEvent(
      new CustomEvent('start', { detail: { sessionId: this.id } })
    );
  }

  private _createPlaceholderFromBounds(
    scene: any,
    element: any
  ): Object3D | null {
    const part = this._options?.part as any;
    const hasBounds =
      part &&
      part.type === 'scene' &&
      part.bounds &&
      part.bounds.min &&
      part.bounds.max;

    if (!hasBounds) return null;

    const bounds = part.bounds;

    const width = bounds.max[0] - bounds.min[0];
    const height = bounds.max[1] - bounds.min[1];
    const depth = bounds.max[2] - bounds.min[2];

    const geometry = new BoxGeometry(width, height, depth);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
    });
    const boxMesh = new Mesh(geometry, material);

    boxMesh.castShadow = false;
    boxMesh.receiveShadow = false;

    boxMesh.position.set(
      (bounds.max[0] + bounds.min[0]) / 2,
      (bounds.max[1] + bounds.min[1]) / 2,
      (bounds.max[2] + bounds.min[2]) / 2
    );

    const placeholder = new Object3D();
    placeholder.add(boxMesh);

    placeholder.name = this._options?.name
      ? this._options.name + `_${+new Date()}`
      : this.id;

    placeholder.userData = {
      selectable: true,
      ...(placeholder.userData || {}),
    };
    placeholder.userData.isPlacementPlaceholder = true;

    if (this._options?.snappingPoints) {
      try {
        placeholder.userData.snappingPoints = this._options.snappingPoints;
      } catch (e) {
        // ignore
      }
    }
    if (typeof this._options?.selectable !== 'undefined')
      placeholder.userData.selectable = this._options.selectable;

    try {
      scene.target.add(placeholder);
    } catch (e) {
      scene.add(placeholder);
    }

    try {
      placeholder.visible = false;
    } catch (e) {}

    try {
      element[$needsRender]();
    } catch (e) {}

    return placeholder;
  }

  // Internal: load low-res placeholder and insert into scene
  async _loadPlaceholder() {
    if (!this._element) return;
    const scene = (this._element as any)[$scene];
    if (!scene) return;

    try {
      const element = this._element as any;

      // Resolve low-res URL: use callback if no direct URL provided
      let lowResUrl = this._lowResSrc;
      if (!lowResUrl && this._options?.getLowResUrl) {
        lowResUrl = await this._options.getLowResUrl();
      }

      if (!lowResUrl) {
        const placeholder = this._createPlaceholderFromBounds(scene, element);
        if (placeholder) {
          this.placeholder = placeholder;
          (this as any).dispatchEvent(
            new CustomEvent('placeholder-loaded', {
              detail: { sessionId: this.id, placeholder },
            })
          );
          return;
        }

        // No placeholder - session will track cursor position only, but will never commit
        this.log(
          '[puzzler] PlacementSession: No low-res URL provided, skipping placeholder'
        );
        return;
      }

      if (!this._element) return;
      const loader = (this._element as any)[$renderer].loader;
      const gltf = await loader.load(lowResUrl, this._element, (p: number) => {
        // Progress for placeholder load (0..1)
        try {
          (this as any).dispatchEvent(
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
      if (typeof this._options?.selectable !== 'undefined')
        placeholder.userData.selectable = this._options.selectable;

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

      (this as any).dispatchEvent(
        new CustomEvent('placeholder-loaded', {
          detail: { sessionId: this.id, placeholder },
        })
      );
      if (!this._element) return;
      (this._element as any)[$needsRender]();
    } catch (error) {
      (this as any).dispatchEvent(
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
    if (!this._element) return;

    try {
      const world = (this._element as any)[$getMouseWorldPoint](
        clientX,
        clientY
      ) as Vector3 | null;
      if (!world) {
        // pointer outside or no valid ray intersection
        (this as any).dispatchEvent(
          new CustomEvent('update', {
            detail: { sessionId: this.id, worldPoint: null },
          })
        );
        return;
      }

      // Store cursor position for later use (even if no placeholder exists)
      this._lastCursorPosition = { x: world.x, y: world.y, z: world.z };
      // Also store this as the target bottom-center position
      this._targetBottomCenter = { x: world.x, y: world.y, z: world.z };

      // If no placeholder exists, just track position and return
      if (!this.placeholder) {
        (this as any).dispatchEvent(
          new CustomEvent('update', {
            detail: {
              sessionId: this.id,
              worldPoint: { x: world.x, y: world.y, z: world.z },
            },
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

      // Position placeholder at cursor location with bbox adjustment
      // Calculate bbox in true local space by temporarily removing from parent
      const parent = this.placeholder.parent;
      const originalPos = this.placeholder.position.clone();
      const originalQuat = this.placeholder.quaternion.clone();
      const originalScale = this.placeholder.scale.clone();

      // Temporarily remove from parent to calculate bbox in world space = local space
      if (parent) {
        parent.remove(this.placeholder);
      }

      this.placeholder.position.set(0, 0, 0);
      this.placeholder.quaternion.set(0, 0, 0, 1);
      this.placeholder.scale.set(1, 1, 1);
      this.placeholder.updateMatrixWorld(true);

      const bboxLocal = new Box3().setFromObject(this.placeholder);

      // Bottom-center in object's local coordinate system
      const bottomCenterLocal = new Vector3(
        (bboxLocal.min.x + bboxLocal.max.x) / 2,
        bboxLocal.min.y,
        (bboxLocal.min.z + bboxLocal.max.z) / 2
      );

      // Restore to parent
      if (parent) {
        parent.add(this.placeholder);
      }
      this.placeholder.position.copy(originalPos);
      this.placeholder.quaternion.copy(originalQuat);
      this.placeholder.scale.copy(originalScale);

      // Get scene.target's world position
      const element = this._element as any;
      const scene = element[$scene];
      const target = scene?.target;
      if (target) {
        target.updateMatrixWorld(true);
      }
      const targetWorldPos = new Vector3();
      if (target) {
        target.getWorldPosition(targetWorldPos);
      }

      // Cursor is in world space
      const cursorWorld = new Vector3(world.x, world.y, world.z);

      // Calculate local position: (cursorWorld - targetWorldPos) - bottomCenterOffset
      // This ensures: targetWorldPos + objectLocalPos + bottomCenterOffset = cursorWorld
      const objectLocalPos = new Vector3()
        .subVectors(cursorWorld, targetWorldPos)
        .sub(bottomCenterLocal);

      this.placeholder.position.copy(objectLocalPos);

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
              this.log(
                '[puzzler] updatePosition applying snap offset:',
                offset.toArray()
              );
              this.placeholder.position.add(offset);
              this.log(
                '[puzzler] updatePosition after snap:',
                this.placeholder.position.toArray()
              );

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

      (this as any).dispatchEvent(
        new CustomEvent('update', {
          detail: {
            sessionId: this.id,
            worldPoint: { x: world.x, y: world.y, z: world.z },
          },
        })
      );

      if (!this._element) return;
      (this._element as any)[$needsRender]();
    } catch (error) {
      // If helper is not present or fails, emit error and no-op
      (this as any).dispatchEvent(
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

  /**
   * Sets the commit position to a fallback location when the pointer was
   * released outside the viewer (e.g. on a button). Default: X and Z to 0,
   * Y unchanged from the current moving object. Further logic may be added later.
   */
  applyFallbackCommitPosition() {
    try {
      if (this.placeholder) {
        const y = this.placeholder.position.y;
        this.placeholder.position.set(0, y, 0);
        this._targetBottomCenter = null;
        this._lastCursorPosition = null;
        return;
      }
      const element = this._element as any;
      const scene = element?.[$scene];
      const target = scene?.target;
      if (!target || !this._lastCursorPosition) return;
      const cursorWorld = new Vector3(
        this._lastCursorPosition.x,
        this._lastCursorPosition.y,
        this._lastCursorPosition.z
      );
      const cursorLocal = new Vector3();
      target.worldToLocal(cursorLocal.copy(cursorWorld));
      const fallbackLocal = new Vector3(0, cursorLocal.y, 0);
      const fallbackWorld = new Vector3();
      target.localToWorld(fallbackWorld.copy(fallbackLocal));
      this._targetBottomCenter = {
        x: fallbackWorld.x,
        y: fallbackWorld.y,
        z: fallbackWorld.z,
      };
      this._lastCursorPosition = {
        x: fallbackWorld.x,
        y: fallbackWorld.y,
        z: fallbackWorld.z,
      };
    } catch (_) {}
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
    // can position UI (hotspots) at the geometric center of the object.
    // Hotspots expect positions in local space (relative to scene.target).
    let centerDetail: { x: number; y: number; z: number } | null = null;
    try {
      if (this.placeholder) {
        // Placeholder is already in local space, use its position directly
        this.log(
          '[puzzler] commit: reading placeholder.position:',
          this.placeholder.position.toArray()
        );
        centerDetail = {
          x: this.placeholder.position.x,
          y: this.placeholder.position.y,
          z: this.placeholder.position.z,
        };
        this.log(
          '[puzzler] commit: centerDetail from placeholder:',
          centerDetail
        );
      } else if (this._targetBottomCenter) {
        // No placeholder, convert cursor world position to local space
        const scene = (this._element as any)[$scene];
        const target = scene?.target;

        const cursorWorld = new Vector3(
          this._targetBottomCenter.x,
          this._targetBottomCenter.y,
          this._targetBottomCenter.z
        );

        // Convert world to local space
        if (target) {
          target.worldToLocal(cursorWorld);
        }

        centerDetail = { x: cursorWorld.x, y: cursorWorld.y, z: cursorWorld.z };
      } else if (this._lastCursorPosition) {
        // Fallback: convert last cursor position from world to local space
        const scene = (this._element as any)[$scene];
        const target = scene?.target;

        const cursorWorld = new Vector3(
          this._lastCursorPosition.x,
          this._lastCursorPosition.y,
          this._lastCursorPosition.z
        );

        if (target) {
          target.worldToLocal(cursorWorld);
        }

        centerDetail = { x: cursorWorld.x, y: cursorWorld.y, z: cursorWorld.z };
      }
    } catch (_) {
      centerDetail = null;
    }

    // Resolve high-res URL: use callback if no direct URL provided
    let srcToLoad = finalSrc || this._highResSrc;
    if (!srcToLoad && this._options?.getHighResUrl) {
      this.log(
        '[puzzler] PlacementSession.commit: invoking getHighResUrl callback'
      );
      try {
        srcToLoad = await this._options.getHighResUrl();
      } catch (e) {
        if (this.error) {
          this.error(
            '[puzzler] PlacementSession.commit: getHighResUrl callback failed',
            e
          );
        }
        (this as any).dispatchEvent(
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
      if (this.error) {
        this.error('[puzzler] PlacementSession.commit: no high-res URL', {
          sessionId: this.id,
        });
      }
      (this as any).dispatchEvent(
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

    (this as any).dispatchEvent(
      new CustomEvent('loading-start', {
        detail: {
          sessionId: this.id,
          src: srcToLoad,
          center: centerDetail,
        },
      })
    );

    const element = this._element;
    this._endInteractive();

    if (!element) return Promise.reject(new Error('No element'));

    return this._placeFinalGlb(element, srcToLoad);
  }

  private async _placeFinalGlb(element: any, srcToLoad: string) {
    const loader = (element as any)[$renderer].loader;
    const scene = (element as any)[$scene];

    try {
      const gltf = await loader.load(srcToLoad, element, (p: number) => {
        try {
          (this as any).dispatchEvent(
            new CustomEvent('progress', {
              detail: { sessionId: this.id, phase: 'final', progress: p },
            })
          );
        } catch (e) {}
      });

      if (!gltf || !gltf.scene) {
        throw new Error('Loaded GLTF missing scene');
      }

      if (this.placeholder) {
        gltf.scene.position.copy(this.placeholder.position);
        gltf.scene.quaternion.copy(this.placeholder.quaternion);
        gltf.scene.scale.copy(this.placeholder.scale);
        gltf.scene.name = this.placeholder.name;

        const placeholderBBox = new Box3().setFromObject(this.placeholder);
        const finalBBox = new Box3().setFromObject(gltf.scene);

        const placeholderHeight = placeholderBBox.max.y - placeholderBBox.min.y;
        const finalHeight = finalBBox.max.y - finalBBox.min.y;

        const heightDiff = finalHeight - placeholderHeight;
        if (
          Number.isFinite(placeholderHeight) &&
          Number.isFinite(finalHeight) &&
          Number.isFinite(heightDiff) &&
          Math.abs(heightDiff) > 0.01
        ) {
          gltf.scene.position.y -= heightDiff;
        }
      } else {
        if (this._targetBottomCenter) {
          gltf.scene.position.set(0, 0, 0);
          gltf.scene.updateMatrixWorld(true);
          const bboxLocal = new Box3().setFromObject(gltf.scene);

          const bottomCenterLocal = new Vector3(
            (bboxLocal.min.x + bboxLocal.max.x) / 2,
            bboxLocal.min.y,
            (bboxLocal.min.z + bboxLocal.max.z) / 2
          );

          const target = (scene as any).target;
          if (target) {
            target.updateMatrixWorld(true);
          }
          const targetWorldPos = new Vector3();
          if (target) {
            target.getWorldPosition(targetWorldPos);
          }

          const cursorWorld = new Vector3(
            this._targetBottomCenter.x,
            this._targetBottomCenter.y,
            this._targetBottomCenter.z
          );

          const objectLocalPos = new Vector3()
            .subVectors(cursorWorld, targetWorldPos)
            .sub(bottomCenterLocal);

          gltf.scene.position.copy(objectLocalPos);
        } else if (this._lastCursorPosition) {
          gltf.scene.position.set(
            this._lastCursorPosition.x,
            this._lastCursorPosition.y,
            this._lastCursorPosition.z
          );
          this.log(
            '[puzzler] Placed object using cursor position:',
            gltf.scene.position.toArray(),
            'from cursor:',
            this._lastCursorPosition
          );
        } else {
          const message =
            '[puzzler] No placeholder or cursor position - object placed at origin';
          if (this.warn) {
            this.warn(message);
          }
        }
        gltf.scene.name = this._options?.name
          ? this._options.name + `_${+new Date()}`
          : this.id;
      }

      gltf.scene.userData = {
        selectable: true,
        ...gltf.scene.userData,
        id: this._options?.id || this.id,
        name: this._options?.name || this.id,
        part: this._options?.part,
      };
      if (this._options?.snappingPoints) {
        try {
          gltf.scene.userData.snappingPoints = this._options.snappingPoints;
        } catch (e) {}
      }
      gltf.scene.userData.isPlacedObject = true;
      if (typeof this._options?.selectable !== 'undefined')
        gltf.scene.userData.selectable = this._options.selectable;

      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        scene.add(gltf.scene);
      }

      try {
        const el = element as any;
        if (scene && typeof scene.updateBoundingBox === 'function') {
          try {
            scene.updateBoundingBox();
          } catch (e) {
            el.error?.(
              '[puzzler] PlacementSession._placeFinalGlb: updateBoundingBox failed',
              e
            );
          }
        }
      } catch (e) {}

      (element as any)[$needsRender]();

      try {
        const el = element as any;
        const pending =
          el && el.pendingSnapConnection ? el.pendingSnapConnection : null;
        if (!pending) {
          try {
            this.log(
              'ld-modular: PlacementSession.commit running fallback snap search for new node',
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
                        this.log(
                          'ld-modular: PlacementSession.commit fallback found connection',
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

      try {
        const el = element as any;
        const pending =
          el && el.pendingSnapConnection ? el.pendingSnapConnection : null;
        if (pending) {
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
            el.completeSnapConnection && el.completeSnapConnection(pending);
          } catch (e) {}

          try {
            el._setPendingSnapConnection && el._setPendingSnapConnection(null);
          } catch (e) {}
        }
      } catch (e) {}

      this._cleanupPlaceholder(element);

      try {
        if (!element) return Promise.reject(new Error('No element'));
        (element as any)[$needsRender]();
        try {
          (element as any).updateSnappingPointSlots &&
            (element as any).updateSnappingPointSlots();
        } catch (e) {}
      } catch (e) {}

      this.state = 'ended';
      const detail = { sessionId: this.id, placedNode: gltf.scene };
      (this as any).dispatchEvent(new CustomEvent('loaded', { detail }));
      return { id: this.id, node: gltf.scene };
    } catch (error) {
      this._cleanupPlaceholder(element);
      this.state = 'cancelled';
      (this as any).dispatchEvent(
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
    (this as any).dispatchEvent(
      new CustomEvent('cancel', { detail: { sessionId: this.id } })
    );
    this._endInteractive();
  }

  private _cleanupPlaceholder(element?: any) {
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

    const el = element || this._element;
    if (el) {
      (el as any)[$needsRender]();
    }
  }

  private _endInteractive() {
    // Drop reference to element so caller may start another interactive session
    this._element = null;
  }
}
