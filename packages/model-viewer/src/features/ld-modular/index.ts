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
import type { Part, SnapPoint } from '@london-dynamics/types/planner';

import { Constructor } from '../../utilities.js';
import { SelectionChangeDetail } from '../ld-selection/index.js';
import ModelViewerElementBase, {
  $needsRender,
  $scene,
  $renderer,
  $tick,
  $userInputElement,
} from '../../model-viewer-base.js';
import { getMouseWorldPointOnPlacementPlane } from '../../utilities/mouse-world-point.js';

import {
  getSnappingPointWorldPosition,
  createSnappedGroup,
  getSnappedGroup,
  findSnappingConnections,
  getPrimarySurfaceSnapPoint,
  requiresSurfaceSnap,
} from '../../utilities/snapping-points.js';
import {
  applySurfaceSnapTransform,
  clientToNdc,
  findSurfaceSnapHitForNdc,
  findRoomSurfaceHitForNdc,
  findSurfaceSnapHitOnWall,
  getBaseModelObject,
  getRoomFloorY,
  invalidateRoomSurfaceIndexCache,
  tryResnapToNearestWall,
  type SurfaceSnapHit,
} from '../../utilities/surface-snapping.js';
import { PlacementCursor } from './placement-cursor.js';
import {
  type ClipboardChangeDetail,
  type ClipboardChangeReason,
  type ClipboardEntry,
  type ClipboardState,
  createSessionId,
  disposeClipboardEntry,
  entryRequiresSurfaceSnap,
  isClipboardCopyTarget,
  snapshotClipboardTargets,
  toClipboardStateEntry,
  commitPasteTargets,
  getSelectionClipboardItems,
  getSelectionLeaderIndex,
} from './clipboard.js';
import {PasteSession, type PasteCommitResult, type PasteSessionHost} from './paste-session.js';
import { applyPointerPlacementPose, applySelectionPointerPlacementPose } from './placement-pose.js';

import { getErrorMessage } from '../../utilities/errors.js';

import { $controls } from '../controls.js';
import { updateSlots, createSlotElement } from './slots.js';
import { Euler } from 'three';
import {
  $selectObjectForControls,
  $clearSelectedObject,
  getObjectAnchorScreenProjection,
  ObjectAnchorSphereCacheEntry,
} from '../ld-floating-object-anchor.js';
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
import { shouldIgnoreModularDeleteKeydown } from './modular-delete-keydown.js';
import {
  normalizeSignedAngleDelta,
  ROTATION_CONTROLS_FINE_SNAP_MODIFIER_KEY,
  RotationControlDisc,
  snapRotationYToStepGrid,
} from './rotation-control-disc.js';
import {
  applyTransformValuesToObject,
  captureStructureMementoFromNodes,
  UndoHistoryManager,
  type DetachedNodeRecord,
  type HistoryChangeDetail,
  type HistoryState,
  type StructureNodeMemento,
} from './undo-history.js';
import {
  ActiveTransform,
  BeginTransformSessionOptions,
  computeTransformDelta,
  getObjectDisplayName,
  inferRotationAxesFromParsed,
  normalizeAngleDeltaDeg,
  SELECTION_TRANSFORM_PIVOT_NAME,
  SELECTION_TRANSFORM_PIVOT_UUID,
  TransformAxis,
  TransformComponent,
  TransformEventDetail,
  TransformSource,
  TransformValues,
} from './transform-events.js';
import {
  type AlignAction,
  applyWorldPositionDelta,
  computeAlignDistributeDeltas,
  getAlignActionLabel,
  resolveLayoutContext,
  type WallLayoutContext,
} from './align-distribute.js';
import { Selection } from '@london-dynamics/types/puzzler';

export type {
  ActiveTransform,
  BeginTransformSessionOptions,
  TransformAxis,
  TransformComponent,
  TransformEventDetail,
  TransformSource,
  TransformTarget,
  TransformValues,
} from './transform-events.js';
export {PasteSession} from './paste-session.js';
export {
  computeTransformDelta,
  getObjectDisplayName,
  inferRotationAxesFromParsed,
  normalizeAngleDeltaDeg,
  SELECTION_TRANSFORM_PIVOT_NAME,
  SELECTION_TRANSFORM_PIVOT_UUID,
  shortestAngleDeltaDeg,
} from './transform-events.js';
export type {
  HistoryChangeDetail,
  HistoryChangeReason,
  HistoryEntryKind,
  HistoryEntrySummary,
  HistoryState,
} from './undo-history.js';

function isRotationFineSnapModifierActive(e: PointerEvent): boolean {
  return e.getModifierState(ROTATION_CONTROLS_FINE_SNAP_MODIFIER_KEY);
}

// Re-export SnapPoint type for external use
export type { SnapPoint };

export type PlacementOptions = {
  mass?: number;
  name?: string;
  id?: string;
  part?: Partial<Part>;
  selection?: Selection;
  selectable?: boolean;
  editable?: boolean;
  snapPoints?: SnapPoint[]; // Optional planner snap points relative to object center
  // Callback to fetch the low-res URL
  getLowResUrl?: () => Promise<string | undefined>;
  // Callback to fetch the high-res URL
  getHighResUrl?: () => Promise<string | undefined>;
};

export type PlacementGraphNode = {
  /** Unique object key (`Object3D.name`), used for Three.js lookups. */
  name: string;
  /** Human-readable label from `userData.name` or `userData.part.name`. */
  displayName?: string;
  uuid: string;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
  part: Partial<Part> | undefined;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  children?: PlacementGraphNode[];
};

export type GlbBoundsResult = {
  filename: string;
  min: [number, number, number];
  max: [number, number, number];
};

const DEFAULT_SNAP_POINT_ROTATION: [number, number, number] = [0, 0, 0];
const ROOM_WALL_BACKFACE_HIDE_THRESHOLD = 0.001;

function getPlacementSnapPoints(
  options?: PlacementOptions
): SnapPoint[] | undefined {
  return options?.snapPoints ?? options?.part?.snapPoints;
}

/** Unique key for `Object3D.name` and snap/lookup APIs. */
function getPlacementObjectKey(
  sessionId: string,
  options?: PlacementOptions
): string {
  return options?.id || sessionId;
}

/** Clean display label stored in `userData.name`. */
function getPlacementDisplayName(
  options?: PlacementOptions
): string | undefined {
  return (
    options?.name ??
    (options?.part as { name?: string } | undefined)?.name
  );
}

function applyPlacementObjectIdentity(
  object: Object3D,
  sessionId: string,
  options?: PlacementOptions
): void {
  const objectKey = getPlacementObjectKey(sessionId, options);
  object.name = objectKey;
  object.userData = object.userData || {};
  object.userData.id = objectKey;
  const displayName = getPlacementDisplayName(options);
  if (displayName !== undefined) {
    object.userData.name = displayName;
  }
}

/** Resolved selectable flag for committed placed objects (not placeholders). */
function getPlacementSelectable(options?: PlacementOptions): boolean {
  if (options?.selectable !== undefined) return options.selectable;
  const partSelectable = (options?.part as { selectable?: boolean } | undefined)
    ?.selectable;
  if (partSelectable !== undefined) return partSelectable;
  return true;
}

function markPlacementPlaceholderNonSelectable(placeholder: Object3D): void {
  placeholder.traverse((child) => {
    child.userData.isPlacementPlaceholder = true;
    child.userData.selectable = false;
  });
}

export type BulkPlacementItem = {
  id: string;
  part?: Partial<Part>;
  selection?: Selection;
  transform: {
    position: [number, number, number];
    // Rotation in radians (Three.js Euler order XYZ)
    rotation: [number, number, number];
    scale: [number, number, number];
  };
};

type ImmediatePlacementTransform = {
  position?: [number, number, number];
  // Rotation in radians (Three.js Euler order XYZ)
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

export type HoverChangeDetail = {
  hovered: boolean;
  uuid: string;
  name: string;
  metadata: Record<string, unknown>;
  anchor: {
    centerX: number;
    centerY: number;
    radiusPx: number;
    isVisible: boolean;
  } | null;
};

export type CopyPartOptions = {
  interactive?: boolean;
  initialMouse?: { clientX: number; clientY: number };
};

export type PasteOptions = {
  clientX?: number;
  clientY?: number;
  select?: boolean;
};

export type PasteResult = PasteCommitResult;

export type {
  ClipboardChangeDetail,
  ClipboardChangeReason,
  ClipboardState,
} from './clipboard.js';

type RotationOptions = {
  order?: EulerOrder;
  animate?: boolean;
  /** When true, apply rotation without dispatching transform events. */
  silent?: boolean;
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
  getGlbBounds(src: string): Promise<GlbBoundsResult>;
  getGlbBoundsMany(srcs: string[]): Promise<GlbBoundsResult[]>;
  attachObject: AttachFunction;
  attachMaterial: AttachMaterialFunction;
  clear: ClearSceneFunction;
  disableBaseModelShadows: boolean;
  srcIsRoom: boolean;
  walls: boolean;
  floor: boolean;
  rotationControls: boolean;
  disableXRotationControls: boolean;
  disableYRotationControls: boolean;
  disableZRotationControls: boolean;
  rotationControlsMajorStep: number;
  rotationControlsFineStep: number;
  highlightColor: string;
  cursor: boolean;

  setPosition(objectName: string, value: [number, number, number]): void;
  setPosition(value: [number, number, number]): void;
  setRotation(
    objectName: string,
    anglesDegrees: [number, number, number],
    options?: RotationOptions
  ): void;
  setRotation(
    anglesDegrees: [number, number, number],
    options?: RotationOptions
  ): void;
  setScale(objectName: string, value: [number, number, number]): void;
  setScale(value: [number, number, number]): void;

  setRotationX(
    objectName: string,
    x: number | string,
    options?: RotationOptions
  ): void;
  setRotationX(x: number | string, options?: RotationOptions): void;
  setRotationY(
    objectName: string,
    y: number | string,
    options?: RotationOptions
  ): void;
  setRotationY(y: number | string, options?: RotationOptions): void;
  setRotationZ(
    objectName: string,
    z: number | string,
    options?: RotationOptions
  ): void;
  setRotationZ(z: number | string, options?: RotationOptions): void;
  setPositionX(objectName: string, x: number): void;
  setPositionX(x: number): void;
  setPositionY(objectName: string, y: number): void;
  setPositionY(y: number): void;
  setPositionZ(objectName: string, z: number): void;
  setPositionZ(z: number): void;

  setScaleX(objectName: string, sx: number): void;
  setScaleX(sx: number): void;
  setScaleY(objectName: string, sy: number): void;
  setScaleY(sy: number): void;
  setScaleZ(objectName: string, sz: number): void;
  setScaleZ(sz: number): void;

  getPosition(objectName: string): [number, number, number];
  getPosition(): [number, number, number][];
  getRotation(objectName: string): [number, number, number];
  getRotation(): [number, number, number][];
  getScale(objectName: string): [number, number, number];
  getScale(): [number, number, number][];

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

  getPart: (objectUuid: string) => Object3D | null;

  replacePart: (
    objectUuid: string,
    src?: string,
    options?: PlacementOptions
  ) => Promise<void>;

  getPlacementTree(): PlacementGraphNode[];

  // Higher-level API functions
  getSelectedObject: () => Object3D | null;
  getSelectedObjects?: () => Object3D[];
  selectPart?: (node: Object3D) => boolean;
  selectGroup?: (node: Object3D) => boolean;
  selectAll?: () => void;
  deselectAll?: () => void;
  applyRectangleSelection?: (
    rect: {left: number; top: number; right: number; bottom: number},
    options?: {mode?: 'replace' | 'add' | 'remove' | 'toggle'}
  ) => void;
  ungroupSelectedObject?: () => boolean;
  clearSelection?: () => void;

  removeObject: (objectName: string, options?: { animate?: boolean }) => void;
  removeSelectedObjects: (options?: { animate?: boolean }) => void;

  deleteNode?: (node: Object3D) => boolean;
  groupSelectedObjects?: () => Object3D | null;
  breakGroup?: (group: Object3D) => boolean;
  breakLink?: (connectionId: string) => boolean;

  maxUndoSteps: number;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  clearUndoHistory(): void;
  getHistoryState(): HistoryState;

  copyPart: (
    objectUuid?: string,
    options?: CopyPartOptions
  ) => PasteSession | void;
  paste: (options?: PasteOptions) => Promise<PasteResult | null>;
  cancelPaste: () => void;
  clearClipboard: () => void;
  getClipboardState: () => ClipboardState;

  alignObjects(action: AlignAction): boolean;
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

    @property({ type: Boolean, attribute: 'src-is-room' })
    srcIsRoom: boolean = false;

    @property({ type: Boolean, attribute: 'walls' })
    walls: boolean = false;

    @property({ type: Boolean, attribute: 'floor' })
    floor: boolean = false;

    @property({ type: Boolean, attribute: 'rotation-controls' })
    rotationControls: boolean = false;

    @property({ type: Boolean, attribute: 'disable-x-rotation-controls' })
    disableXRotationControls: boolean = true;

    @property({ type: Boolean, attribute: 'disable-y-rotation-controls' })
    disableYRotationControls: boolean = false;

    @property({ type: Boolean, attribute: 'disable-z-rotation-controls' })
    disableZRotationControls: boolean = true;

    @property({ type: Number, attribute: 'rotation-controls-major-step' })
    rotationControlsMajorStep: number = 0;

    @property({ type: Number, attribute: 'rotation-controls-fine-step' })
    rotationControlsFineStep: number = 0;

    @property({ type: String, attribute: 'highlight-color' })
    highlightColor: string = '#3b82f6';

    @property({ type: Boolean, attribute: 'cursor' })
    cursor: boolean = false;

    @property({ type: Number, attribute: 'max-undo-steps' })
    maxUndoSteps: number = 50;

    private _undoHistory: UndoHistoryManager | null = null;

    // Store bound event handler reference
    private _boundSelectionChangeHandler: ((event: Event) => void) | null =
      null;
    private _boundDeleteKeyHandler: ((event: KeyboardEvent) => void) | null =
      null;
    private _boundLoadHandler: (() => void) | null = null;
    private _removeSelectedFlushScheduled = false;
    private _removeSelectedMergedOptions: { animate?: boolean } | undefined =
      undefined;
    private _roomWallVisibilityCacheDirty: boolean = true;
    private _roomWallEntries: Map<
      string,
      {
        wall: Object3D;
        skirting: Object3D | null;
        wallNormalLocal: Vector3;
      }
    > = new Map();
    private _roomAttachedObjectsByWallName: Map<string, Set<Object3D>> =
      new Map();
    private _roomFloorAttachedObjects: Set<Object3D> = new Set();
    private _roomHiddenAttachedObjects: Set<Object3D> = new Set();
    private _roomHiddenSkirtings: Set<Object3D> = new Set();
    private _tmpCameraWorldPos: Vector3 = new Vector3();
    private _tmpWallWorldPos: Vector3 = new Vector3();
    private _tmpCameraToWallDir: Vector3 = new Vector3();
    private _tmpWallWorldNormal: Vector3 = new Vector3();
    private _tmpMeshWorldQuat: Quaternion = new Quaternion();
    private _tmpWallWorldQuat: Quaternion = new Quaternion();

    private _placementCursorMesh: PlacementCursor | null = null;
    private _cursorWorldPosition: { x: number; y: number; z: number } | null =
      null;
    private _cursorPointerMoveRaf = 0;
    private _pendingCursorPointerMove: {
      clientX: number;
      clientY: number;
    } | null = null;
    private _boundCursorPointerMove: ((e: PointerEvent) => void) | null = null;
    private _boundCursorPointerLeave: ((e: PointerEvent) => void) | null = null;

    private _clipboardEntry: ClipboardEntry | null = null;
    private _activePasteSession: PasteSession | null = null;
    private _pastePointerTeardown: (() => void) | null = null;
    private _lastCursorClient: { clientX: number; clientY: number } | null =
      null;

    connectedCallback() {
      super.connectedCallback();
      this._syncRoomSourceMode();
      this._ensureUndoHistory().maxUndoSteps = this.maxUndoSteps;

      // Keep stable references so listeners are properly removed.
      this._boundSelectionChangeHandler = (event: Event) => {
        this._onSelectionChangeForPuzzler(event);
      };
      this.addEventListener(
        'selection-change',
        this._boundSelectionChangeHandler
      );

      this._boundDeleteKeyHandler = (event: KeyboardEvent) => {
        if (shouldIgnoreModularDeleteKeydown(event)) {
          return;
        }

        const selectedObjects = ((this as any).selectedObjects ||
          []) as Object3D[];

        if (selectedObjects.length === 0) return;

        event.preventDefault();
        this.removeSelectedObjects();
      };
      this.addEventListener('keydown', this._boundDeleteKeyHandler);

      this._boundLoadHandler = () => {
        this._syncRoomSourceMode();
        invalidateRoomSurfaceIndexCache(this._findRoomSurfaceObject());
        this._markRoomWallVisibilityCacheDirty();
        this._applyRoomTaggedSurfaceVisibility();
        if (this.srcIsRoom) {
          this._logRoomTaggedSurfaceVisibility('load');
        }
      };
      this.addEventListener('load', this._boundLoadHandler);

      // Setup drag handlers for puzzler
      try {
        this.setupDragHandlers();
      } catch (e) {}
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);
      if (
        changedProperties.has('srcIsRoom') ||
        changedProperties.has('disableBaseModelShadows') ||
        changedProperties.has('src')
      ) {
        if (changedProperties.has('src')) {
          invalidateRoomSurfaceIndexCache(this._findRoomSurfaceObject());
        }
        this._syncRoomSourceMode();
        this._markRoomWallVisibilityCacheDirty();
      }

      if (
        changedProperties.has('walls') ||
        changedProperties.has('floor') ||
        changedProperties.has('srcIsRoom')
      ) {
        this._applyRoomTaggedSurfaceVisibility();
        if (this.srcIsRoom) {
          this._logRoomTaggedSurfaceVisibility('updated');
        }
      }

      if (
        changedProperties.has('rotationControls') ||
        changedProperties.has('disableYRotationControls') ||
        changedProperties.has('rotationControlsMajorStep') ||
        changedProperties.has('rotationControlsFineStep') ||
        changedProperties.has('highlightColor')
      ) {
        this._syncRotationControlDiscLifecycle();
      }

      if (changedProperties.has('cursor')) {
        this._syncCursorLifecycle();
      }

      if (changedProperties.has('highlightColor')) {
        this._applyCursorHighlightColor();
      }
    }

    private _syncRoomSourceMode() {
      if (!this.srcIsRoom) {
        this._resetRoomTaggedSurfaceVisibilityOverrides();
        this._resetRoomAttachedVisibility();
        return;
      }

      if (!this.disableBaseModelShadows) {
        this.disableBaseModelShadows = true;
      }
      if (!(this as any).disableBaseModelSelection) {
        (this as any).disableBaseModelSelection = true;
      }
      this._applyRoomSourceRuntimeFlags();
      this._markRoomWallVisibilityCacheDirty();
    }

    private _applyRoomSourceRuntimeFlags() {
      const scene = (this as any)[$scene];
      if (!scene) return;
      const baseModel = getBaseModelObject(scene);
      if (!baseModel) return;

      baseModel.userData.selectable = false;
      baseModel.traverse((child) => {
        child.userData.selectable = false;
        if ('castShadow' in child) {
          (child as any).castShadow = false;
        }
        if ('receiveShadow' in child) {
          (child as any).receiveShadow = true;
        }
      });
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.cancelRequestedShadowUpdate();
      this._resetRoomTaggedSurfaceVisibilityOverrides();
      this._resetRoomAttachedVisibility();

      // Clean up event listener
      if (this._boundSelectionChangeHandler) {
        this.removeEventListener(
          'selection-change',
          this._boundSelectionChangeHandler as EventListener
        );
        this._boundSelectionChangeHandler = null;
      }
      if (this._boundDeleteKeyHandler) {
        this.removeEventListener('keydown', this._boundDeleteKeyHandler);
        this._boundDeleteKeyHandler = null;
      }
      if (this._boundLoadHandler) {
        this.removeEventListener('load', this._boundLoadHandler);
        this._boundLoadHandler = null;
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
      this._disposeRotationControlDisc();
      this._detachCursorPointerListeners();
      this._disposePlacementCursorMesh();
      this.clearClipboard();
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

      try {
        this._undoHistory?.clear();
        this._undoHistory = null;
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
        options,
        true
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

          if (
            !placeholder &&
            (options.position || options.rotation || options.scale)
          ) {
            placeholder = new Object3D();
            applyPlacementObjectIdentity(placeholder, session.id, options);
            markPlacementPlaceholderNonSelectable(placeholder);
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
                options.rotation[0],
                options.rotation[1],
                options.rotation[2]
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
        getHighResUrl?: (
          item: BulkPlacementItem
        ) => Promise<string | undefined>;
      }
    ): Promise<Array<{ id: string; node: Object3D }>> {
      const total = items.length;
      if (total === 0) return [];

      const results: Array<{ id: string; node: Object3D }> = new Array(total);
      const concurrency = Math.max(1, options?.concurrency ?? 4);

      this._ensureUndoHistory().beginBatch();

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

          const placementOptions: PlacementOptions &
            ImmediatePlacementTransform = {
            ...(item.part ? { part: item.part } : {}),
            id: item.id,
            name: item.part?.name || item.id,
            position: transform.position,
            rotation: transform.rotation,
            scale: transform.scale,
            selection: item.selection,
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

      this._ensureUndoHistory().endBatch(
        total === 1 ? undefined : `Place ${total} objects`
      );

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
        const shouldShowSnapPoints =
          this.snappingPointsVisible ||
          ((this as any).selectedObjects &&
            (this as any).selectedObjects.length > 0) ||
          (this._activePlacementSession &&
            this._activePlacementSession.state === 'placing') ||
          ((this as any).isDragging && this.snappingEnabled);

        if (shouldShowSnapPoints) {
          this.updateSnappingPointSlots();
        }
      } catch (e) {}
      try {
        if (this._breakLinkSlotsVisible) this.updateBreakLinkSlots();
      } catch (e) {}
      try {
        this._updateRoomAttachedVisibility();
      } catch (e) {}
      try {
        this._tickPlacementCursor(delta);
      } catch (e) {}
      try {
        this._updateRotationControlDisc();
      } catch (e) {}

      // Step rotation animations (framerate independent) and clear shadow
      // update pending flags. `delta` is the time since the last tick and
      // is used to advance animations by real time rather than frame count.
      try {
        // Step registered quaternion animations (delta is in ms)
        const animatingBefore = new Set(this._rotationAnimationMap.keys());
        const rotBefore = animatingBefore.size;
        stepQuatAnimations(this._rotationAnimationMap, delta);
        const animatingAfter = new Set(this._rotationAnimationMap.keys());
        const rotAfter = animatingAfter.size;
        for (const obj of animatingAfter) {
          if (!this._transformSessions.has(obj)) {
            this._beginTransformSession(obj, {
              source: 'animation',
              components: ['rotation'],
              axes: { rotation: ['x', 'y', 'z'] },
            });
          }
          this._emitTransformUpdate(obj);
        }
        for (const obj of animatingBefore) {
          if (!animatingAfter.has(obj)) {
            this._endTransformSession(obj);
          }
        }

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

    invalidateSurfaceSnappingCache(): void {
      invalidateRoomSurfaceIndexCache(this._findRoomSurfaceObject());
    }

    private _roomShellNameLower(name: string | undefined): string {
      return (name || '').toLowerCase();
    }

    /** Wall shell: `wall_*` meshes or a `walls` group (e.g. Babylon exports). */
    private _isRoomWallShellNode(name: string | undefined): boolean {
      const n = this._roomShellNameLower(name);
      return n === 'walls' || n.startsWith('wall_');
    }

    /** Floor shell: `floor_*` meshes or a node named `floor` (e.g. Babylon exports). */
    private _isRoomFloorShellNode(name: string | undefined): boolean {
      const n = this._roomShellNameLower(name);
      return n === 'floor' || n.startsWith('floor_');
    }

    /**
     * When `src-is-room` is off, restore tagged room meshes to visible so
     * leaving room mode does not leave wall/floor shell nodes stuck hidden.
     */
    private _resetRoomTaggedSurfaceVisibilityOverrides() {
      const scene = (this as any)[$scene];
      if (!scene) return;
      const baseModel = getBaseModelObject(scene);
      if (!baseModel) return;
      baseModel.traverse((child) => {
        if (
          this._isRoomWallShellNode(child.name) ||
          this._isRoomFloorShellNode(child.name)
        ) {
          child.visible = true;
        }
      });
      (this as any)[$needsRender]();
    }

    /**
     * Applies `walls` / `floor` to wall shell nodes (`wall_*`, optional `walls`
     * group) and floor shell nodes (`floor_*`, or a node named `floor`) when
     * `src-is-room` is set; no-op otherwise (and clears overrides when room mode
     * is off).
     */
    private _applyRoomTaggedSurfaceVisibility() {
      if (!this.srcIsRoom) {
        this._resetRoomTaggedSurfaceVisibilityOverrides();
        return;
      }
      const scene = (this as any)[$scene];
      if (!scene) return;
      const baseModel = getBaseModelObject(scene);
      if (!baseModel) return;
      baseModel.traverse((child) => {
        if (this._isRoomWallShellNode(child.name)) {
          child.visible = !!this.walls;
        } else if (this._isRoomFloorShellNode(child.name)) {
          child.visible = !!this.floor;
        }
      });
      (this as any)[$needsRender]();
    }

    private _logRoomTaggedSurfaceVisibility(source: 'load' | 'updated') {
      const host = this as any;
      if (!this.srcIsRoom || !host.debug) {
        return;
      }
      if (typeof host.log === 'function') {
        host.log(
          `[src-is-room] Room tagged surfaces (${source}): walls=${this.walls}, floor=${this.floor}. ` +
            'Wall shell: `walls` or `wall_*`; floor shell: `floor` or `floor_*`. ' +
            'Wall attachments follow `walls` and camera backface; floor-surface attachments follow `floor`.'
        );
      }
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

    async getGlbBounds(src: string): Promise<GlbBoundsResult> {
      const loader = (this as any)[$renderer]?.loader;
      if (!loader || typeof loader.load !== 'function') {
        throw new Error('Renderer loader unavailable for bounds calculation');
      }

      const gltf = await loader.load(src, this, () => {});
      if (!gltf?.scene) {
        throw new Error('Loaded GLTF missing scene');
      }

      gltf.scene.updateMatrixWorld(true);
      const bbox = new Box3().setFromObject(gltf.scene);
      if (
        !Number.isFinite(bbox.min.x) ||
        !Number.isFinite(bbox.min.y) ||
        !Number.isFinite(bbox.min.z) ||
        !Number.isFinite(bbox.max.x) ||
        !Number.isFinite(bbox.max.y) ||
        !Number.isFinite(bbox.max.z)
      ) {
        throw new Error('Computed GLB bounds are invalid');
      }

      let filename = src;
      try {
        filename = new URL(src).pathname.split('/').pop() || src;
      } catch (e) {}

      return {
        filename,
        min: [bbox.min.x, bbox.min.y, bbox.min.z],
        max: [bbox.max.x, bbox.max.y, bbox.max.z],
      };
    }

    async getGlbBoundsMany(srcs: string[]): Promise<GlbBoundsResult[]> {
      const results: GlbBoundsResult[] = [];
      for (const src of srcs) {
        results.push(await this.getGlbBounds(src));
      }
      return results;
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

      const extractData = (obj: Object3D): PlacementGraphNode => {
        const isGroup = !!obj.userData?.isSnappedGroup;
        const displayName = getObjectDisplayName(obj);
        return {
          name: obj.name,
          ...(displayName !== obj.name ? { displayName } : {}),
          uuid: obj.uuid,
          position: obj.position.clone(),
          rotation: this._getPlacementTreeRotationFromObject(obj),
          scale: obj.scale.clone(),
          part: obj.userData?.part,
          selection: obj.userData?.selection,
          snapPoints: obj.userData?.snapPoints,
          ...(isGroup && {
            children: obj.children.map((child) => extractData(child)),
          }),
        };
      };

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

    private _getSelectedRootObjects(): Object3D[] {
      const selected = (
        ((this as any).selectedObjects || []) as Object3D[]
      ).filter(Boolean);
      if (selected.length === 0) return [];
      const selectedSet = new Set<Object3D>(selected);
      return selected.filter((node) => {
        let parent: Object3D | null = node.parent as Object3D | null;
        while (parent) {
          if (selectedSet.has(parent)) return false;
          parent = parent.parent as Object3D | null;
        }
        return true;
      });
    }

    private _resolveObjectByName(name: string): Object3D | null {
      if (name !== this._currentObject?.name) {
        this._currentObject = undefined;
      }
      if (!this._currentObject) {
        this._currentObject = (this as any)[$scene].getObjectByName(name);
      }
      return (this._currentObject as Object3D) || null;
    }

    private _getTargetObjects(name?: string): Object3D[] {
      if (name) {
        const obj = this._resolveObjectByName(name);
        return obj ? [obj] : [];
      }
      return this._getSelectedRootObjects();
    }

    private _getRotationFromObject(obj: Object3D): [number, number, number] {
      const logical = this._getLogicalRotationFromObject(obj);
      if (logical) {
        return logical;
      }
      return [
        obj.rotation.x * (180 / Math.PI),
        obj.rotation.y * (180 / Math.PI),
        obj.rotation.z * (180 / Math.PI),
      ];
    }

    private _getLogicalRotationFromObject(
      obj: Object3D
    ): [number, number, number] | null {
      const raw = obj.userData?.ldLogicalRotationDeg;
      if (
        Array.isArray(raw) &&
        raw.length === 3 &&
        raw.every((v) => typeof v === 'number' && Number.isFinite(v))
      ) {
        return [raw[0], raw[1], raw[2]];
      }
      return null;
    }

    private _setLogicalRotationOnObject(
      obj: Object3D,
      value: [number, number, number]
    ) {
      const normalizeAngleDeg = (deg: number) => {
        // Keep output stable within [-180, 180) for API/event consumers.
        const normalized = ((deg % 360) + 360) % 360;
        return normalized >= 180 ? normalized - 360 : normalized;
      };
      obj.userData = obj.userData || {};
      obj.userData.ldLogicalRotationDeg = [
        normalizeAngleDeg(value[0]),
        normalizeAngleDeg(value[1]),
        normalizeAngleDeg(value[2]),
      ];
    }

    private _getPlacementTreeRotationFromObject(obj: Object3D): Euler {
      const logical = this._getLogicalRotationFromObject(obj);
      if (!logical) {
        return obj.rotation.clone();
      }
      return new Euler(
        logical[0] * (Math.PI / 180),
        logical[1] * (Math.PI / 180),
        logical[2] * (Math.PI / 180),
        obj.rotation.order
      );
    }

    private _getPositionFromObject(obj: Object3D): [number, number, number] {
      return [obj.position.x, obj.position.y, obj.position.z];
    }

    private _getScaleFromObject(obj: Object3D): [number, number, number] {
      return [obj.scale.x, obj.scale.y, obj.scale.z];
    }

    private _cloneTransformValues(obj: Object3D): TransformValues {
      return {
        position: [...this._getPositionFromObject(obj)] as [
          number,
          number,
          number,
        ],
        rotation: [...this._getRotationFromObject(obj)] as [
          number,
          number,
          number,
        ],
        scale: [...this._getScaleFromObject(obj)] as [number, number, number],
      };
    }

    private _ensureUndoHistory(): UndoHistoryManager {
      if (!this._undoHistory) {
        this._undoHistory = new UndoHistoryManager({
          getObjectByUuid: (uuid) => this.getPart(uuid),
          cloneTransformValues: (obj) => this._cloneTransformValues(obj),
          applyTransformValues: (obj, values) =>
            this._applyTransformValues(obj, values),
          getDisplayName: (obj) => getObjectDisplayName(obj),
          detachNode: (node, selectionUuids) =>
            this._detachNodeForUndo(node, selectionUuids),
          reattachNode: (record) => this._reattachNodeFromUndo(record),
          captureStructureMemento: (nodes) =>
            captureStructureMementoFromNodes(nodes, (obj) =>
              this._cloneTransformValues(obj)
            ),
          applyStructureMemento: (mementos) =>
            this._applyStructureMemento(mementos),
          findSceneRoot: () => {
            const scene = (this as any)[$scene];
            return scene?.target ?? scene ?? null;
          },
          dispatchHistoryChange: (detail) => this._dispatchHistoryChange(detail),
          requestRender: () => (this as any)[$needsRender](),
        });
      }
      return this._undoHistory;
    }

    undo(): boolean {
      return this._ensureUndoHistory().undo();
    }

    redo(): boolean {
      return this._ensureUndoHistory().redo();
    }

    canUndo(): boolean {
      return this._ensureUndoHistory().canUndo();
    }

    canRedo(): boolean {
      return this._ensureUndoHistory().canRedo();
    }

    clearUndoHistory(): void {
      this._ensureUndoHistory().clear();
    }

    getHistoryState(): HistoryState {
      return this._ensureUndoHistory().getHistoryState();
    }

    alignObjects(action: AlignAction): boolean {
      const targets = this._getSelectedRootObjects();
      const context = resolveLayoutContext(targets, (uuid) => this.getPart(uuid));
      if (!context) {
        return false;
      }

      const deltas = computeAlignDistributeDeltas(action, targets, context);
      if (deltas.size === 0) {
        return false;
      }

      const isWall = context.kind === 'wall';
      this._beginSelectionTransformSession(targets, {
        source: 'align-distribute',
        components: ['position'],
        axes: {position: isWall ? ['x', 'y', 'z'] : ['x', 'z']},
        historyLabel: getAlignActionLabel(action, targets.length),
      });

      if (!this._selectionTransformSession) {
        return false;
      }

      for (const obj of targets) {
        const delta = deltas.get(obj.uuid);
        if (delta) {
          applyWorldPositionDelta(obj, delta);
        }
        if (isWall && !this._resnapWallObjectAfterAlignMove(obj, context)) {
          this._abortSelectionTransformSession();
          return false;
        }
      }

      this.requestShadowUpdate();
      (this as any)[$needsRender]();
      this._endSelectionTransformSession();
      return true;
    }

    private _dispatchHistoryChange(detail: HistoryChangeDetail): void {
      try {
        (this as any).dispatchEvent(
          new CustomEvent<HistoryChangeDetail>('history-change', {
            detail,
            bubbles: true,
            composed: true,
          })
        );
      } catch (e) {}
    }

    private _applyTransformValues(obj: Object3D, values: TransformValues): void {
      this._setLogicalRotationOnObject(obj, values.rotation);
      applyTransformValuesToObject(obj, values);
      this.requestShadowUpdate();
    }

    private _detachNodeForUndo(
      node: Object3D,
      selectionUuids?: string[]
    ): DetachedNodeRecord {
      const parent = node.parent;
      const parentUuid = parent?.uuid ?? null;
      const siblingIndex = parent ? parent.children.indexOf(node) : -1;
      if (parent) {
        parent.remove(node);
      }
      return { node, parentUuid, siblingIndex, selectionUuids };
    }

    private _reattachNodeFromUndo(record: DetachedNodeRecord): void {
      const scene = (this as any)[$scene];
      const root = scene?.target ?? scene ?? null;
      let parent: Object3D | null = null;
      if (record.parentUuid) {
        parent = this.getPart(record.parentUuid);
      }
      if (!parent) {
        parent = root;
      }
      if (!parent) return;

      if (
        record.siblingIndex >= 0 &&
        record.siblingIndex <= parent.children.length
      ) {
        parent.children.splice(record.siblingIndex, 0, record.node);
        record.node.parent = parent;
      } else {
        parent.add(record.node);
      }
      (this as any)[$needsRender]();
    }

    private _applyStructureMemento(mementos: StructureNodeMemento[]): void {
      const history = this._ensureUndoHistory();
      const scene = (this as any)[$scene];
      const root = scene?.target ?? scene ?? null;
      if (!root) return;

      const validUuids = new Set(
        mementos.filter((memento) => memento.exists).map((memento) => memento.uuid)
      );

      const nodesToRemove: Object3D[] = [];
      root.traverse((child: Object3D) => {
        if (
          (child.userData?.isSnappedGroup || child.userData?.isPlacedObject) &&
          !validUuids.has(child.uuid)
        ) {
          nodesToRemove.push(child);
        }
      });

      for (const node of nodesToRemove) {
        if (node.userData?.isSnappedGroup) {
          const parent = node.parent;
          const children = [...node.children];
          for (const child of children) {
            node.remove(child);
            parent?.add(child);
            if (child.userData) {
              delete child.userData.groupId;
              delete child.userData.isInGroup;
            }
          }
        }
        if (node.parent) {
          if (node.userData?.isSnappedGroup) {
            history.detachToGraveyard(node);
          } else {
            node.parent.remove(node);
          }
        }
      }

      for (const memento of mementos) {
        if (!memento.exists) continue;

        let obj =
          this.getPart(memento.uuid) ?? history.getGraveyardNode(memento.uuid);
        if (!obj) continue;

        let parent: Object3D | null = null;
        if (memento.parentUuid) {
          parent = this.getPart(memento.parentUuid);
        }
        if (!parent) {
          parent = root;
        }
        if (!parent) continue;

        if (obj.parent !== parent) {
          obj.parent?.remove(obj);
          if (
            memento.siblingIndex >= 0 &&
            memento.siblingIndex <= parent.children.length
          ) {
            parent.children.splice(memento.siblingIndex, 0, obj);
            obj.parent = parent;
          } else {
            parent.add(obj);
          }
        } else if (
          memento.siblingIndex >= 0 &&
          memento.siblingIndex < parent.children.length &&
          parent.children[memento.siblingIndex] !== obj
        ) {
          const currentIndex = parent.children.indexOf(obj);
          if (currentIndex >= 0) {
            parent.children.splice(currentIndex, 1);
            parent.children.splice(memento.siblingIndex, 0, obj);
          }
        }

        this._applyTransformValues(obj, memento.transform);
        obj.userData = obj.userData || {};
        for (const [key, value] of Object.entries(memento.userData)) {
          if (value === undefined) {
            delete obj.userData[key];
          } else if (key === 'snapConnections' && Array.isArray(value)) {
            obj.userData.snapConnections = value.map((item) =>
              typeof item === 'object' && item !== null ? {...item} : item
            );
          } else if (key === 'ldLogicalRotationDeg' && Array.isArray(value)) {
            obj.userData.ldLogicalRotationDeg = [...value];
          } else if (key === 'part' && typeof value === 'object' && value) {
            obj.userData.part = {...(value as object)};
          } else {
            obj.userData[key] = value;
          }
        }
        if (memento.name) {
          obj.name = memento.name;
        }
        if (!memento.userData.isInGroup) {
          delete obj.userData.isInGroup;
          delete obj.userData.groupId;
        }
      }
    }

    private _recordTransformSessionFromObject(obj: Object3D): void {
      const session = this._transformSessions.get(obj);
      if (!session || this._ensureUndoHistory().isReplaying) return;

      const after = this._cloneTransformValues(obj);
      const before = session.startSnapshot;
      this._ensureUndoHistory().recordTransform(
        [{uuid: obj.uuid, before, after}],
        {
          source: session.source,
          components: session.components,
          targetNames: [getObjectDisplayName(obj)],
          targetUuids: [obj.uuid],
        }
      );
    }

    private _recordSelectionTransformSession(): void {
      const session = this._selectionTransformSession;
      if (!session || this._ensureUndoHistory().isReplaying) return;

      const changes: Array<{
        uuid: string;
        before: TransformValues;
        after: TransformValues;
      }> = [];
      const targetNames: string[] = [];
      const targetUuids: string[] = [];

      for (const obj of session.targets) {
        const before = session.startSnapshots.get(obj.uuid);
        if (!before) continue;
        const after = this._cloneTransformValues(obj);
        changes.push({uuid: obj.uuid, before, after});
        targetNames.push(getObjectDisplayName(obj));
        targetUuids.push(obj.uuid);
      }

      this._ensureUndoHistory().recordTransform(changes, {
        source: session.source,
        components: session.components,
        targetNames,
        targetUuids,
        label: session.historyLabel,
      });
    }

    private _collectStructureNodes(...seeds: Array<Object3D | null | undefined>): Object3D[] {
      const nodes: Object3D[] = [];
      const seen = new Set<string>();
      const visit = (obj: Object3D | null | undefined) => {
        if (!obj || seen.has(obj.uuid)) return;
        seen.add(obj.uuid);
        nodes.push(obj);
        if (obj.userData?.isSnappedGroup) {
          for (const child of obj.children) {
            visit(child);
          }
        }
      };

      for (const seed of seeds) {
        visit(seed ?? undefined);
        const group = seed ? getSnappedGroup(seed as Object3D) : null;
        if (group) {
          visit(group);
          for (const child of group.children) {
            visit(child);
          }
        }
      }
      return nodes;
    }

    _recordPlacementAdd(node: Object3D): void {
      if (this._ensureUndoHistory().isReplaying) return;
      this._ensureUndoHistory().recordAdd(node);
    }

    private _recordStructureChange(
      beforeNodes: Object3D[],
      afterNodes: Object3D[],
      label: string
    ): void {
      const history = this._ensureUndoHistory();
      if (history.isReplaying) return;
      const before = history.captureNodesMemento(beforeNodes);
      const after = history.captureNodesMemento(afterNodes);
      const targetNames = afterNodes
        .filter((node) => node.userData?.isPlacedObject)
        .map((node) => getObjectDisplayName(node));
      const targetUuids = afterNodes.map((node) => node.uuid);
      history.recordStructure(
        before,
        after,
        label,
        targetNames.length > 0 ? targetNames : afterNodes.map((n) => getObjectDisplayName(n)),
        targetUuids
      );
    }

    private _buildActiveTransform(obj: Object3D): ActiveTransform | null {
      const session = this._transformSessions.get(obj);
      if (!session) {
        return null;
      }
      const current = this._cloneTransformValues(obj);
      const rotationYDelta =
        session.source === 'rotation-disc-y'
          ? session.gestureRotationYDelta
          : undefined;
      return {
        source: session.source,
        components: session.components,
        axes: session.axes ?? {},
        delta: computeTransformDelta(current, session.startSnapshot, {
          rotationYDelta,
        }),
      };
    }

    private _buildTransformEventDetail(
      obj: Object3D,
      active: ActiveTransform | null
    ): TransformEventDetail {
      return {
        target: { uuid: obj.uuid, name: getObjectDisplayName(obj) },
        transform: this._cloneTransformValues(obj),
        active,
      };
    }

    private _dispatchTransformEvent(
      type: 'transformstart' | 'transform' | 'transformend',
      _object: Object3D,
      detail: TransformEventDetail
    ) {
      try {
        (this as any).dispatchEvent(
          new CustomEvent<TransformEventDetail>(type, {
            detail,
            bubbles: true,
            composed: true,
          })
        );
      } catch (e) {}
    }

    private _beginTransformSession(
      obj: Object3D,
      options: BeginTransformSessionOptions
    ) {
      if (this._transformSessions.has(obj)) {
        return;
      }
      const startSnapshot = this._cloneTransformValues(obj);
      this._transformSessions.set(obj, {
        ...options,
        startSnapshot,
        gestureRotationYDelta: 0,
      });
      this._dispatchTransformEvent(
        'transformstart',
        obj,
        this._buildTransformEventDetail(obj, this._buildActiveTransform(obj))
      );
    }

    private _emitTransformUpdate(obj: Object3D) {
      this._dispatchTransformEvent(
        'transform',
        obj,
        this._buildTransformEventDetail(obj, this._buildActiveTransform(obj))
      );
    }

    private _endTransformSession(obj: Object3D) {
      if (!this._transformSessions.has(obj)) {
        return;
      }
      this._recordTransformSessionFromObject(obj);
      this._transformSessions.delete(obj);
      this._dispatchTransformEvent(
        'transformend',
        obj,
        this._buildTransformEventDetail(obj, null)
      );
    }

    private _emptyTransformValues(): TransformValues {
      return {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
    }

    private _computeSelectionPivotFromTargets(
      targets: Object3D[],
      out: Vector3
    ): Vector3 {
      if (this._rotationPivotOverride) {
        return out.copy(this._rotationPivotOverride);
      }
      const box = new Box3();
      for (const target of targets) {
        target.updateMatrixWorld(true);
        box.expandByObject(target);
      }
      if (
        !Number.isFinite(box.min.x) ||
        !Number.isFinite(box.max.x) ||
        targets.length === 0
      ) {
        return out.set(0, this.originalFloorY ?? 0, 0);
      }
      const floorY = this.originalFloorY ?? 0;
      out.set(
        (box.min.x + box.max.x) * 0.5,
        floorY,
        (box.min.z + box.max.z) * 0.5
      );
      return out;
    }

    private _updateRotationPivotFromSelection() {
      if (this._rotationGestureActive) {
        return;
      }
      const targets = this._getRotationDiscTargets();
      this._computeSelectionPivotFromTargets(targets, this._rotationPivotWorld);
    }

    private _getSelectionPivotTransformValues(): TransformValues {
      const session = this._selectionTransformSession;
      const pivot = this._rotationPivotWorld;
      const rotationY =
        (session?.startPivotRotationY ?? 0) +
        (session?.gestureRotationYDelta ?? 0);
      const pos = session
        ? [
            session.startPivotPosition.x +
              (session.gestureDelta.position[0] ?? 0),
            session.startPivotPosition.y +
              (session.gestureDelta.position[1] ?? 0),
            session.startPivotPosition.z +
              (session.gestureDelta.position[2] ?? 0),
          ]
        : [pivot.x, pivot.y, pivot.z];
      return {
        position: pos as [number, number, number],
        rotation: [0, normalizeAngleDeltaDeg(rotationY), 0],
        scale: [1, 1, 1],
      };
    }

    private _buildSelectionTransformEventDetail(
      active: ActiveTransform | null
    ): TransformEventDetail {
      const session = this._selectionTransformSession;
      const targets = session?.targets ?? [];
      return {
        target: {
          uuid: SELECTION_TRANSFORM_PIVOT_UUID,
          name: SELECTION_TRANSFORM_PIVOT_NAME,
        },
        targets: targets.map((obj) => ({
          uuid: obj.uuid,
          name: getObjectDisplayName(obj),
        })),
        transform: this._getSelectionPivotTransformValues(),
        active,
      };
    }

    private _buildActiveSelectionTransform(): ActiveTransform | null {
      const session = this._selectionTransformSession;
      if (!session) return null;
      return {
        source: session.source,
        components: session.components,
        axes: session.axes,
        delta: {
          position: [...session.gestureDelta.position] as [
            number,
            number,
            number,
          ],
          rotation: [...session.gestureDelta.rotation] as [
            number,
            number,
            number,
          ],
          scale: [...session.gestureDelta.scale] as [number, number, number],
        },
      };
    }

    private _beginSelectionTransformSession(
      targets: Object3D[],
      options: BeginTransformSessionOptions
    ) {
      if (targets.length < 2 || this._selectionTransformSession) {
        return;
      }
      this._updateRotationPivotFromSelection();
      const startSnapshots = new Map<string, TransformValues>();
      for (const obj of targets) {
        startSnapshots.set(obj.uuid, this._cloneTransformValues(obj));
      }
      const startPivotPosition = this._rotationPivotWorld.clone();
      this._selectionTransformSession = {
        targets: [...targets],
        source: options.source,
        components: options.components,
        axes: options.axes ?? {},
        historyLabel: options.historyLabel,
        startSnapshots,
        startPivotPosition,
        startPivotRotationY: 0,
        gestureDelta: this._emptyTransformValues(),
        gestureRotationYDelta: 0,
      };
      this._dispatchTransformEvent(
        'transformstart',
        targets[0],
        this._buildSelectionTransformEventDetail(
          this._buildActiveSelectionTransform()
        )
      );
    }

    private _emitSelectionTransformUpdate() {
      if (!this._selectionTransformSession) return;
      this._dispatchTransformEvent(
        'transform',
        this._selectionTransformSession.targets[0],
        this._buildSelectionTransformEventDetail(
          this._buildActiveSelectionTransform()
        )
      );
    }

    private _endSelectionTransformSession() {
      if (!this._selectionTransformSession) return;
      const first = this._selectionTransformSession.targets[0];
      this._recordSelectionTransformSession();
      this._selectionTransformSession = null;
      this._dispatchTransformEvent(
        'transformend',
        first,
        this._buildSelectionTransformEventDetail(null)
      );
    }

    private _abortSelectionTransformSession() {
      if (!this._selectionTransformSession) return;
      const session = this._selectionTransformSession;
      const first = session.targets[0];
      for (const obj of session.targets) {
        const before = session.startSnapshots.get(obj.uuid);
        if (before) {
          this._applyTransformValues(obj, before);
        }
      }
      this._selectionTransformSession = null;
      this._dispatchTransformEvent(
        'transformend',
        first,
        this._buildSelectionTransformEventDetail(null)
      );
    }

    private _resnapWallObjectAfterAlignMove(
      object: Object3D,
      context: WallLayoutContext
    ): boolean {
      const snapPoint = getPrimarySurfaceSnapPoint(object);
      if (!snapPoint) {
        return false;
      }

      const worldPoint = new Vector3();
      object.updateMatrixWorld(true);
      object.getWorldPosition(worldPoint);

      const hit = findSurfaceSnapHitOnWall(
        context.wall,
        worldPoint,
        context.wallNormal,
        snapPoint,
        object
      );
      if (!hit) {
        return false;
      }

      const roomObject = this._findRoomSurfaceObject();
      const floorY = roomObject ? getRoomFloorY(roomObject) : null;
      applySurfaceSnapTransform(object, snapPoint, hit, floorY);
      if (object.userData?.isPlacedObject === true) {
        this._markRoomWallVisibilityCacheDirty();
      }
      return true;
    }

    private _applyRotationDeltaYAroundPivot(
      targets: Object3D[],
      pivot: Vector3,
      deltaDeg: number
    ) {
      if (Math.abs(deltaDeg) <= 1e-4) return;
      const deltaRad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(deltaRad);
      const sin = Math.sin(deltaRad);
      const tmp = new Vector3();

      for (const target of targets) {
        target.updateMatrixWorld(true);
        target.getWorldPosition(tmp);
        const dx = tmp.x - pivot.x;
        const dz = tmp.z - pivot.z;
        // Match Three.js positive Y rotation (same handedness as euler Y below).
        const rx = dx * cos + dz * sin;
        const rz = -dx * sin + dz * cos;
        tmp.x = pivot.x + rx;
        tmp.z = pivot.z + rz;
        if (target.parent) {
          target.parent.worldToLocal(tmp);
        }
        target.position.copy(tmp);

        const current = this._getRotationFromObject(target);
        const finalDegs: [number, number, number] = [
          current[0],
          current[1] + deltaDeg,
          current[2],
        ];
        this._setLogicalRotationOnObject(target, finalDegs);
        const order = target.rotation.order;
        target.rotation.copy(
          new Euler(
            finalDegs[0] * (Math.PI / 180),
            finalDegs[1] * (Math.PI / 180),
            finalDegs[2] * (Math.PI / 180),
            order
          )
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    private _runApiTransformOneShot(
      obj: Object3D,
      options: BeginTransformSessionOptions,
      mutate: () => void
    ) {
      if (this._transformSessions.has(obj)) {
        mutate();
        this._emitTransformUpdate(obj);
        return;
      }
      this._beginTransformSession(obj, options);
      mutate();
      this._emitTransformUpdate(obj);
      this._endTransformSession(obj);
    }

    private _dispatchObjectRemoveEvent(object: Object3D) {
      try {
        (this as any).dispatchEvent(
          new CustomEvent('object-remove', {
            detail: {
              name: object.name,
              uuid: object.uuid,
            },
            bubbles: true,
            composed: true,
          })
        );
      } catch (e) {}
    }

    private _setRotationOnObject(
      obj: Object3D,
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

      // If this object is currently animating, ignore any new instructions
      // (prevents competing instructions causing small overshoots when callers
      // spam "+=..." while an animation is running).
      if (this._rotationAnimationMap.has(obj)) {
        return;
      }

      // Seed current rotation in degrees (fallback to zeros on error).
      // When animating, derive the current rotation from the object's
      // quaternion to avoid races with in-flight animations; otherwise
      // use local Euler directly.
      let current: [number, number, number] = [0, 0, 0];
      const logicalCurrent = this._getLogicalRotationFromObject(obj);
      if (logicalCurrent) {
        current = logicalCurrent;
      } else if (animate) {
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
          current = this._getRotationFromObject(obj);
        } catch (e) {
          // keep zeros
        }
      }

      const parsed: {
        isRelative: boolean;
        delta?: number;
        absolute?: number;
      }[] = [0, 1, 2].map((i) => {
        const input = value[i];
        if (typeof input === 'number') {
          return { isRelative: false, absolute: input };
        }
        const s = String(input).trim();
        const relMatch = s.match(/^([+-])=\s*([+-]?\d+(?:\.\d+)?)$/);
        if (relMatch) {
          const sign = relMatch[1] === '-' ? -1 : 1;
          const val = parseFloat(relMatch[2]);
          return { isRelative: true, delta: sign * val };
        }
        const parsedNum = parseFloat(s);
        if (!Number.isNaN(parsedNum))
          return { isRelative: false, absolute: parsedNum };
        throw new Error(`Invalid rotation input: "${input}"`);
      });

      const hasRelative = parsed.some((p) => p.isRelative);
      const allAbsoluteMatchCurrent = parsed.every((p, i) => {
        if (p.isRelative) return true;
        const eps = 1e-6;
        return Math.abs((p.absolute ?? 0) - current[i]) < eps;
      });

      const finalDegs: [number, number, number] = [0, 1, 2].map((i) => {
        if (!parsed[i].isRelative) return parsed[i].absolute ?? current[i];
        const delta = parsed[i].delta!;
        if (mode === 'snapToClosest') {
          const step = Math.abs(delta);
          if (step === 0) return current[i];
          const ratio = current[i] / step;
          const nearestInt = Math.round(ratio);
          const eps = 1e-6;
          if (Math.abs(ratio - nearestInt) < eps) {
            return current[i] + (delta > 0 ? step : -step);
          }
          return delta > 0 ? Math.ceil(ratio) * step : Math.floor(ratio) * step;
        }
        return current[i] + delta;
      }) as [number, number, number];

      let endQuat: Quaternion;
      let rotation: Euler | null = null;

      if (
        animate &&
        hasRelative &&
        allAbsoluteMatchCurrent &&
        mode !== 'snapToClosest'
      ) {
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
      } else {
        rotation = new Euler(
          finalDegs[0] * (Math.PI / 180),
          finalDegs[1] * (Math.PI / 180),
          finalDegs[2] * (Math.PI / 180),
          order
        );
        endQuat = new Quaternion().setFromEuler(rotation);
      }

      const silent =
        options?.silent === true || this._transformSessions.has(obj);
      const rotationAxes = inferRotationAxesFromParsed(parsed, current);
      const apiSessionOptions: BeginTransformSessionOptions = {
        source: 'api',
        components: ['rotation'],
        axes: { rotation: rotationAxes },
      };

      const applyInstantRotation = () => {
        this._setLogicalRotationOnObject(obj, finalDegs);
        obj.rotation.copy(rotation!);
      };

      if (!animate) {
        if (silent) {
          applyInstantRotation();
          this.requestShadowUpdate();
          (this as any)[$needsRender]();
          return;
        }
        this._runApiTransformOneShot(obj, apiSessionOptions, () => {
          applyInstantRotation();
        });
        this.requestShadowUpdate();
        (this as any)[$needsRender]();
        return;
      }

      this._setLogicalRotationOnObject(obj, finalDegs);

      try {
        const startQuat = obj.quaternion.clone();
        this._rotationAnimationMap.set(
          obj,
          createQuatAnimation(startQuat, endQuat)
        );
        if (!silent && !this._transformSessions.has(obj)) {
          this._beginTransformSession(obj, {
            source: 'animation',
            components: ['rotation'],
            axes: { rotation: ['x', 'y', 'z'] },
          });
        }
        this.requestShadowUpdate();
        (this as any)[$needsRender]();
        return;
      } catch (e) {
        try {
          if (typeof endQuat !== 'undefined') {
            obj.quaternion.copy(endQuat);
          } else if (rotation) {
            obj.rotation.copy(rotation);
          }
        } catch (err) {
          // ignore
        }
        if (silent) {
          this.requestShadowUpdate();
          (this as any)[$needsRender]();
          return;
        }
        if (this._transformSessions.has(obj)) {
          this._endTransformSession(obj);
        }
        this._runApiTransformOneShot(obj, apiSessionOptions, () => {});
        this.requestShadowUpdate();
        (this as any)[$needsRender]();
      }
    }

    // private [$updateFramingThrottled] = throttle(async () => {
    //   await (this as any)[$scene].updateFraming();
    //   (this as any)[$needsRender]();
    // }, 400);

    setRotation(
      name: string,
      value: [number | string, number | string, number | string],
      options?: RotationOptions
    ): void;
    setRotation(
      value: [number | string, number | string, number | string],
      options?: RotationOptions
    ): void;
    setRotation(
      nameOrValue: string | [number | string, number | string, number | string],
      valueOrOptions?:
        | [number | string, number | string, number | string]
        | RotationOptions,
      options?: RotationOptions
    ) {
      const hasName = typeof nameOrValue === 'string';
      const targetValue = hasName
        ? (valueOrOptions as [
            number | string,
            number | string,
            number | string,
          ])
        : (nameOrValue as [number | string, number | string, number | string]);
      const targetOptions = hasName
        ? options
        : (valueOrOptions as RotationOptions);
      const targets = this._getTargetObjects(
        hasName ? (nameOrValue as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._setRotationOnObject(target, targetValue, targetOptions);
      }
    }

    /**
     * Convenience: set single rotation axis (degrees) without clobbering others.
     * These call through to `setRotation` after seeding the existing rotation
     * (via `getRotation`) so callers can update one axis at a time.
     */
    setRotationX(
      name: string,
      x: number | string,
      options?: RotationOptions
    ): void;
    setRotationX(x: number | string, options?: RotationOptions): void;
    setRotationX(
      nameOrX: string | number,
      xOrOptions?: number | string | RotationOptions,
      options?: RotationOptions
    ) {
      const hasName =
        typeof nameOrX === 'string' &&
        (typeof xOrOptions === 'number' || typeof xOrOptions === 'string');
      const x = (hasName ? xOrOptions : nameOrX) as number | string;
      const callOptions = (hasName ? options : xOrOptions) as
        | RotationOptions
        | undefined;
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof x !== 'number' &&
        !(typeof x === 'string' && relOrNumRE.test(x))
      ) {
        throw new Error('Invalid x value for setRotationX');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrX as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        const rot = this._getRotationFromObject(target) as [
          number | string,
          number | string,
          number | string,
        ];
        rot[0] = x;
        this._setRotationOnObject(target, rot, callOptions);
      }
    }

    setRotationY(
      name: string,
      y: number | string,
      options?: RotationOptions
    ): void;
    setRotationY(y: number | string, options?: RotationOptions): void;
    setRotationY(
      nameOrY: string | number,
      yOrOptions?: number | string | RotationOptions,
      options?: RotationOptions
    ) {
      const hasName =
        typeof nameOrY === 'string' &&
        (typeof yOrOptions === 'number' || typeof yOrOptions === 'string');
      const y = (hasName ? yOrOptions : nameOrY) as number | string;
      const callOptions = (hasName ? options : yOrOptions) as
        | RotationOptions
        | undefined;
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof y !== 'number' &&
        !(typeof y === 'string' && relOrNumRE.test(y))
      ) {
        throw new Error('Invalid y value for setRotationY');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrY as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        const rot = this._getRotationFromObject(target) as [
          number | string,
          number | string,
          number | string,
        ];
        rot[1] = y;
        this._setRotationOnObject(target, rot, callOptions);
      }
    }

    setRotationZ(
      name: string,
      z: number | string,
      options?: RotationOptions
    ): void;
    setRotationZ(z: number | string, options?: RotationOptions): void;
    setRotationZ(
      nameOrZ: string | number,
      zOrOptions?: number | string | RotationOptions,
      options?: RotationOptions
    ) {
      const hasName =
        typeof nameOrZ === 'string' &&
        (typeof zOrOptions === 'number' || typeof zOrOptions === 'string');
      const z = (hasName ? zOrOptions : nameOrZ) as number | string;
      const callOptions = (hasName ? options : zOrOptions) as
        | RotationOptions
        | undefined;
      const relOrNumRE = /^([+-]=?)?\s*[+-]?\d+(\.\d+)?\s*$/;
      if (
        typeof z !== 'number' &&
        !(typeof z === 'string' && relOrNumRE.test(z))
      ) {
        throw new Error('Invalid z value for setRotationZ');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrZ as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        const rot = this._getRotationFromObject(target) as [
          number | string,
          number | string,
          number | string,
        ];
        rot[2] = z;
        this._setRotationOnObject(target, rot, callOptions);
      }
    }

    /**
     * Set absolute local position (meters) for the named object.
     * value: [x, y, z]
     */
    setPosition(name: string, value: [number, number, number]): void;
    setPosition(value: [number, number, number]): void;
    setPosition(
      nameOrValue: string | [number, number, number],
      value?: [number, number, number]
    ) {
      const hasName = typeof nameOrValue === 'string';
      const targetValue = hasName
        ? (value as [number, number, number])
        : (nameOrValue as [number, number, number]);
      if (
        !Array.isArray(targetValue) ||
        targetValue.length !== 3 ||
        targetValue.some((v) => typeof v !== 'number')
      ) {
        throw new Error(
          'Invalid value array. Expected an array of three numbers representing position [x,y,z].'
        );
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrValue as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['position'],
            axes: { position: ['x', 'y', 'z'] },
          },
          () => {
            target.position.set(targetValue[0], targetValue[1], targetValue[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    /**
     * Convenience: set single position axis without clobbering others.
     * These call through to `setPosition` after seeding the existing
     * position (via `getPosition`) so callers can update one axis at a time.
     */
    setPositionX(name: string, x: number): void;
    setPositionX(x: number): void;
    setPositionX(nameOrX: string | number, x?: number) {
      const hasName = typeof nameOrX === 'string' && arguments.length >= 2;
      const targetX = (hasName ? x : nameOrX) as number;
      const targets = this._getTargetObjects(
        hasName ? (nameOrX as string) : undefined
      );
      if (typeof targetX !== 'number' || Number.isNaN(targetX)) {
        throw new Error('Invalid x value for setPositionX');
      }
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['position'],
            axes: { position: ['x'] },
          },
          () => {
            const pos = this._getPositionFromObject(target);
            pos[0] = targetX;
            target.position.set(pos[0], pos[1], pos[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    setPositionY(name: string, y: number): void;
    setPositionY(y: number): void;
    setPositionY(nameOrY: string | number, y?: number) {
      const hasName = typeof nameOrY === 'string' && arguments.length >= 2;
      const targetY = (hasName ? y : nameOrY) as number;
      if (typeof targetY !== 'number' || Number.isNaN(targetY)) {
        throw new Error('Invalid y value for setPositionY');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrY as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['position'],
            axes: { position: ['y'] },
          },
          () => {
            const pos = this._getPositionFromObject(target);
            pos[1] = targetY;
            target.position.set(pos[0], pos[1], pos[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    setPositionZ(name: string, z: number): void;
    setPositionZ(z: number): void;
    setPositionZ(nameOrZ: string | number, z?: number) {
      const hasName = typeof nameOrZ === 'string' && arguments.length >= 2;
      const targetZ = (hasName ? z : nameOrZ) as number;
      if (typeof targetZ !== 'number' || Number.isNaN(targetZ)) {
        throw new Error('Invalid z value for setPositionZ');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrZ as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['position'],
            axes: { position: ['z'] },
          },
          () => {
            const pos = this._getPositionFromObject(target);
            pos[2] = targetZ;
            target.position.set(pos[0], pos[1], pos[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    /**
     * Set absolute local scale for the named object.
     * value: [sx, sy, sz]
     */
    setScale(name: string, value: [number, number, number]): void;
    setScale(value: [number, number, number]): void;
    setScale(
      nameOrValue: string | [number, number, number],
      value?: [number, number, number]
    ) {
      const hasName = typeof nameOrValue === 'string';
      const targetValue = hasName
        ? (value as [number, number, number])
        : (nameOrValue as [number, number, number]);
      if (
        !Array.isArray(targetValue) ||
        targetValue.length !== 3 ||
        targetValue.some((v) => typeof v !== 'number')
      ) {
        throw new Error(
          'Invalid value array. Expected an array of three numbers representing scale [sx,sy,sz].'
        );
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrValue as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['scale'],
            axes: { scale: ['x', 'y', 'z'] },
          },
          () => {
            target.scale.set(targetValue[0], targetValue[1], targetValue[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    /**
     * Convenience: set single scale axis without clobbering others.
     * These call through to `setScale` after seeding the existing
     * scale (via `getScale`) so callers can update one axis at a time.
     */
    setScaleX(name: string, sx: number): void;
    setScaleX(sx: number): void;
    setScaleX(nameOrSx: string | number, sx?: number) {
      const hasName = typeof nameOrSx === 'string' && arguments.length >= 2;
      const targetSx = (hasName ? sx : nameOrSx) as number;
      if (typeof targetSx !== 'number' || Number.isNaN(targetSx)) {
        throw new Error('Invalid sx value for setScaleX');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrSx as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['scale'],
            axes: { scale: ['x'] },
          },
          () => {
            const s = this._getScaleFromObject(target);
            s[0] = targetSx;
            target.scale.set(s[0], s[1], s[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    setScaleY(name: string, sy: number): void;
    setScaleY(sy: number): void;
    setScaleY(nameOrSy: string | number, sy?: number) {
      const hasName = typeof nameOrSy === 'string' && arguments.length >= 2;
      const targetSy = (hasName ? sy : nameOrSy) as number;
      if (typeof targetSy !== 'number' || Number.isNaN(targetSy)) {
        throw new Error('Invalid sy value for setScaleY');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrSy as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['scale'],
            axes: { scale: ['y'] },
          },
          () => {
            const s = this._getScaleFromObject(target);
            s[1] = targetSy;
            target.scale.set(s[0], s[1], s[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    setScaleZ(name: string, sz: number): void;
    setScaleZ(sz: number): void;
    setScaleZ(nameOrSz: string | number, sz?: number) {
      const hasName = typeof nameOrSz === 'string' && arguments.length >= 2;
      const targetSz = (hasName ? sz : nameOrSz) as number;
      if (typeof targetSz !== 'number' || Number.isNaN(targetSz)) {
        throw new Error('Invalid sz value for setScaleZ');
      }
      const targets = this._getTargetObjects(
        hasName ? (nameOrSz as string) : undefined
      );
      if (targets.length === 0) return;
      for (const target of targets) {
        this._runApiTransformOneShot(
          target,
          {
            source: 'api',
            components: ['scale'],
            axes: { scale: ['z'] },
          },
          () => {
            const s = this._getScaleFromObject(target);
            s[2] = targetSz;
            target.scale.set(s[0], s[1], s[2]);
          }
        );
      }
      this.requestShadowUpdate();
      (this as any)[$needsRender]();
    }

    getRotation(name: string): [number, number, number];
    getRotation(): [number, number, number][];
    getRotation(
      name?: string
    ): [number, number, number] | [number, number, number][] {
      if (typeof name === 'string') {
        const obj = this._resolveObjectByName(name);
        if (!obj) {
          throw new Error(`Object with name "${name}" not found.`);
        }
        return this._getRotationFromObject(obj);
      }
      return this._getSelectedRootObjects().map((obj) =>
        this._getRotationFromObject(obj)
      );
    }

    getPosition(name: string): [number, number, number];
    getPosition(): [number, number, number][];
    getPosition(
      name?: string
    ): [number, number, number] | [number, number, number][] {
      if (typeof name === 'string') {
        const obj = this._resolveObjectByName(name);
        if (!obj) {
          throw new Error(`Object with name "${name}" not found.`);
        }
        return this._getPositionFromObject(obj);
      }
      return this._getSelectedRootObjects().map((obj) =>
        this._getPositionFromObject(obj)
      );
    }

    getScale(name: string): [number, number, number];
    getScale(): [number, number, number][];
    getScale(
      name?: string
    ): [number, number, number] | [number, number, number][] {
      if (typeof name === 'string') {
        const obj = this._resolveObjectByName(name);
        if (!obj) {
          throw new Error(`Object with name "${name}" not found.`);
        }
        return this._getScaleFromObject(obj);
      }
      return this._getSelectedRootObjects().map((obj) =>
        this._getScaleFromObject(obj)
      );
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

    private _cursorTrackingActive(): boolean {
      return (
        this.cursor ||
        (this._activePlacementSession?.state === 'placing') === true ||
        this._activePasteSession?.state === 'previewing'
      );
    }

    private _syncCursorLifecycle() {
      if (this._cursorTrackingActive()) {
        this._ensurePlacementCursorMesh();
        this._applyCursorHighlightColor();
        this._attachCursorPointerListeners();
      } else {
        this._detachCursorPointerListeners();
        this._placementCursorMesh?.hide();
        this._cursorWorldPosition = null;
      }
    }

    private _ensurePlacementCursorMesh() {
      if (this._placementCursorMesh) return;
      const scene = (this as any)[$scene];
      const parent = scene?.target || scene;
      if (!parent) return;

      const cursor = new PlacementCursor(() => {
        try {
          (this as any)[$needsRender]();
        } catch (e) {}
      });
      parent.add(cursor);
      this._placementCursorMesh = cursor;
      this._applyCursorHighlightColor();

      const defaultWorld = new Vector3();
      if (scene?.target) {
        scene.target.getWorldPosition(defaultWorld);
      }
      cursor.showOnFloor(defaultWorld);
      this._cursorWorldPosition = {
        x: defaultWorld.x,
        y: defaultWorld.y,
        z: defaultWorld.z,
      };
    }

    private _disposePlacementCursorMesh() {
      if (!this._placementCursorMesh) return;
      this._placementCursorMesh.dispose();
      this._placementCursorMesh = null;
      this._cursorWorldPosition = null;
    }

    private _applyCursorHighlightColor() {
      this._placementCursorMesh?.setHighlightColor(this.highlightColor);
    }

    private _flushCursorPointerMove() {
      this._cursorPointerMoveRaf = 0;
      const pending = this._pendingCursorPointerMove;
      this._pendingCursorPointerMove = null;
      if (!pending) return;
      this._updateCursorFromPointer(pending.clientX, pending.clientY);
    }

    private _attachCursorPointerListeners() {
      if (!this.cursor || this._boundCursorPointerMove) return;

      this._boundCursorPointerMove = (e: PointerEvent) => {
        this._pendingCursorPointerMove = {
          clientX: e.clientX,
          clientY: e.clientY,
        };
        if (this._cursorPointerMoveRaf === 0) {
          this._cursorPointerMoveRaf = requestAnimationFrame(() =>
            this._flushCursorPointerMove()
          );
        }
      };
      this._boundCursorPointerLeave = () => {
        if (this._cursorPointerMoveRaf !== 0) {
          cancelAnimationFrame(this._cursorPointerMoveRaf);
          this._cursorPointerMoveRaf = 0;
        }
        this._pendingCursorPointerMove = null;
        this._cursorWorldPosition = null;
        this._placementCursorMesh?.hide();
        try {
          (this as any)[$needsRender]();
        } catch (e) {}
      };

      this.addEventListener('pointermove', this._boundCursorPointerMove);
      this.addEventListener('pointerleave', this._boundCursorPointerLeave);
    }

    private _detachCursorPointerListeners() {
      if (this._cursorPointerMoveRaf !== 0) {
        cancelAnimationFrame(this._cursorPointerMoveRaf);
        this._cursorPointerMoveRaf = 0;
      }
      this._pendingCursorPointerMove = null;
      if (this._boundCursorPointerMove) {
        this.removeEventListener('pointermove', this._boundCursorPointerMove);
        this._boundCursorPointerMove = null;
      }
      if (this._boundCursorPointerLeave) {
        this.removeEventListener('pointerleave', this._boundCursorPointerLeave);
        this._boundCursorPointerLeave = null;
      }
    }

    _updateCursorFromPointer(clientX: number, clientY: number) {
      this._lastCursorClient = { clientX, clientY };
      if (!this._cursorTrackingActive()) return;

      this._ensurePlacementCursorMesh();
      if (!this._placementCursorMesh) return;

      const floorWorld = getMouseWorldPointOnPlacementPlane(
        this as unknown as HTMLElement,
        (this as any)[$scene],
        clientX,
        clientY
      );

      if (!floorWorld) {
        this._cursorWorldPosition = null;
        this._placementCursorMesh.hide();
        return;
      }

      const scene = (this as any)[$scene];
      const camera = scene?.getCamera ? scene.getCamera() : scene?.camera;
      const roomObject = this._findRoomSurfaceObject();
      let wallHit: SurfaceSnapHit | null = null;
      if (camera && roomObject) {
        const rect = this.getBoundingClientRect();
        const ndc = clientToNdc(clientX, clientY, rect);
        if (ndc) {
          wallHit = findRoomSurfaceHitForNdc(camera, ndc, roomObject);
        }
      }

      if (wallHit && wallHit.surfaceType === 'wall') {
        this._placementCursorMesh.showOnSurface(
          wallHit.point,
          wallHit.normal
        );
        this._cursorWorldPosition = {
          x: wallHit.point.x,
          y: wallHit.point.y,
          z: wallHit.point.z,
        };
      } else {
        this._placementCursorMesh.showOnFloor(floorWorld);
        this._cursorWorldPosition = {
          x: floorWorld.x,
          y: floorWorld.y,
          z: floorWorld.z,
        };
      }

      try {
        (this as any)[$needsRender]();
      } catch (e) {}
    }

    _getCursorWorldPosition(): { x: number; y: number; z: number } | null {
      if (!this._cursorWorldPosition) return null;
      return { ...this._cursorWorldPosition };
    }

    private _tickPlacementCursor(deltaMs: number) {
      this._placementCursorMesh?.tick(deltaMs);
    }

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
      if (type !== 'clear' && selectedObjects.length === 1) {
        const selected = selectedObjects[0];
        try {
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

      // Update break-link slots when exactly one snapped group is selected
      const singleGroup =
        selectedObjects.length === 1 &&
        selectedObjects[0].userData?.isSnappedGroup
          ? selectedObjects[0]
          : null;
      if (type !== 'clear' && singleGroup && selectedObjects.length === 1) {
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

      this._syncRotationControlDiscLifecycle();
      (this as any)[$needsRender]();
    }

    /** Orbit/pan drag off while the pointer is over a selectable. */
    private _pointerHoverDisablesCameraDrag: boolean = false;
    /** Orbit/pan drag off during an interactive placement session. */
    private _placementDisablesCameraDrag: boolean = false;
    /** Combined hover/placement state last pushed to controls. */
    private _cameraDragDisabled: boolean = false;

    private _syncCameraDragDisabled(): void {
      const shouldDisable =
        this._pointerHoverDisablesCameraDrag ||
        this._placementDisablesCameraDrag;
      if (shouldDisable === this._cameraDragDisabled) {
        return;
      }
      this._cameraDragDisabled = shouldDisable;
      try {
        if (shouldDisable) {
          (this as any)[$controls]?.disableDragInteraction?.();
        } else {
          (this as any)[$controls]?.enableDragInteraction?.();
        }
      } catch (_) {}
    }

    /** Toggle hover/select camera-drag disable; only calls controls when state changes. */
    private _setPointerHoverCameraDragDisabled(disabled: boolean): void {
      if (disabled === this._pointerHoverDisablesCameraDrag) {
        return;
      }
      this._pointerHoverDisablesCameraDrag = disabled;
      this._syncCameraDragDisabled();
    }

    private _setPlacementCameraDragDisabled(disabled: boolean): void {
      if (disabled === this._placementDisablesCameraDrag) {
        return;
      }
      this._placementDisablesCameraDrag = disabled;
      this._syncCameraDragDisabled();
    }

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
    private _windowPointerMoveForRotationBound?: (e: PointerEvent) => void;
    private _windowPointerUpForRotationBound?: (e: PointerEvent) => void;
    private _hoveredSelectableObject: Object3D | null = null;
    private _hoverAnchorSphereCache = new WeakMap<
      Object3D,
      ObjectAnchorSphereCacheEntry
    >();
    private _rotationControlDisc: RotationControlDisc | null = null;
    private _rotationGestureActive = false;
    private _rotationGesturePointerId: number | null = null;
    private _rotationGestureStartAngleRad = 0;
    private _rotationGestureStartRotationY = 0;
    private _rotationGestureTargets: Object3D[] = [];
    /** Skips the next selection pointerup after a rotation-disc gesture ends. */
    private _suppressSelectionPointerUp = false;
    private _rotationDiscSizeLockedUuid: string | null = null;
    private _transformSessions = new Map<
      Object3D,
      BeginTransformSessionOptions & {
        startSnapshot: TransformValues;
        /** Sum of applied Y deltas during rotation-disc-y gesture. */
        gestureRotationYDelta: number;
      }
    >();

    private _selectionTransformSession: {
      targets: Object3D[];
      source: TransformSource;
      components: TransformComponent[];
      axes: Partial<Record<TransformComponent, TransformAxis[]>>;
      historyLabel?: string;
      startSnapshots: Map<string, TransformValues>;
      startPivotPosition: Vector3;
      startPivotRotationY: number;
      gestureDelta: TransformValues;
      gestureRotationYDelta: number;
    } | null = null;

    private _rotationPivotWorld = new Vector3();
    private _rotationPivotOverride: Vector3 | null = null;

    private _dragTargets: Object3D[] = [];
    private _dragStartPositions = new Map<string, Vector3>();
    private _dragOffsets = new Map<string, Vector3>();

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
      draggedPoint: SnapPoint;
      targetPoint: SnapPoint;
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
          const draggedPoint: SnapPoint = v.draggedPoint;
          const targetPoint: SnapPoint = v.targetPoint;
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

    private isSnapPointUsed(object: Object3D, snapPoint: SnapPoint): boolean {
      if (!snapPoint?.id) return false;
      const group = getSnappedGroup(object);
      const connections = group?.userData?.snapConnections;
      if (!Array.isArray(connections)) return false;

      const objectKey = object.name || object.uuid;
      return connections.some((connection: any) => {
        const object1Matches =
          connection.object1 === object ||
          connection.object1?.uuid === object.uuid ||
          connection.object1?.name === object.name ||
          connection.a === objectKey ||
          connection.a === object.uuid;
        const object2Matches =
          connection.object2 === object ||
          connection.object2?.uuid === object.uuid ||
          connection.object2?.name === object.name ||
          connection.b === objectKey ||
          connection.b === object.uuid;

        return (
          (object1Matches &&
            (connection.snapPoint1?.id === snapPoint.id ||
              connection.aPoint?.id === snapPoint.id)) ||
          (object2Matches &&
            (connection.snapPoint2?.id === snapPoint.id ||
              connection.bPoint?.id === snapPoint.id))
        );
      });
    }

    private getSnapPointRotationTuple(
      snapPoint: SnapPoint
    ): [number, number, number] {
      return snapPoint.transform?.rotation ?? DEFAULT_SNAP_POINT_ROTATION;
    }

    // Re-declare protected inherited property for TypeScript visibility
    protected currentMousePosition!: Vector2;
    private dragStartMousePosition: Vector2 = new Vector2();
    private dragStartPosition: Vector3 = new Vector3();
    private dragOffset: Vector3 = new Vector3();
    private _tmpDragWorldPos: Vector3 = new Vector3();
    private _tmpDragDesiredLocal: Vector3 = new Vector3();
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
    private ungroupSnappedGroup(
      group: Object3D,
      options?: {skipHistory?: boolean}
    ): boolean {
      if (!group) return false;
      try {
        const beforeNodes = this._collectStructureNodes(group);
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

        if (!options?.skipHistory) {
          this._recordStructureChange(
            beforeNodes,
            this._collectStructureNodes(...children),
            `Ungroup ${getObjectDisplayName(group)}`
          );
        }

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
      draggedPoint: SnapPoint,
      targetPoint: SnapPoint
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
      draggedPoint: SnapPoint;
      targetPoint: SnapPoint;
    }) {
      const beforeNodes = this._collectStructureNodes(
        connection.draggedObject,
        connection.targetObject
      );
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
      // which group we're operating on. Skip during interactive placement so
      // drop/commit does not select the placeholder or a half-placed group.
      if (focusGroup) {
        const session = this._activePlacementSession;
        const placementActive =
          !!session &&
          (session.state === 'placing' || session.state === 'loading');
        if (!placementActive) {
          try {
            (this as any)._selectObject(focusGroup);
          } catch (e) {}
        }
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

      this._recordStructureChange(
        beforeNodes,
        this._collectStructureNodes(
          focusGroup,
          connection.draggedObject,
          connection.targetObject
        ),
        `Snap ${getObjectDisplayName(connection.draggedObject)} to ${getObjectDisplayName(connection.targetObject)}`
      );

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
      const snapPointsFound: any[] = [];
      if (targetObject) {
        targetObject.traverse((child: any) => {
          // Show slots for all objects with snapping points
          if (child.userData?.snapPoints) {
            const snapPoints = child.userData.snapPoints as SnapPoint[];
            snapPoints.forEach((snapPoint, index) => {
              if (this.isSnapPointUsed(child, snapPoint)) return;

              const worldPos = getSnappingPointWorldPosition(child, snapPoint);
              const [rx, ry, rz] = this.getSnapPointRotationTuple(snapPoint);
              const rotation = new Euler(rx, ry, rz);
              const normal = new Vector3(0, 0, 1).applyEuler(rotation);
              const worldNormal = normal
                .clone()
                .transformDirection(child.matrixWorld);

              const viewVector = new Vector3()
                .copy((camera as any).position)
                .sub(worldPos);
              const dotProduct = viewVector.dot(worldNormal);
              const facingCamera = dotProduct > 0;

              snapPointsFound.push({
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

      updateSlots(snapPointsFound, {
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
        (this as any).selectedObjects.length !== 1
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
      {
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

    private _findRoomSurfaceObject(): Object3D | null {
      const scene = (this as any)[$scene];
      if (!scene) return null;
      return getBaseModelObject(scene);
    }

    private _markRoomWallVisibilityCacheDirty() {
      this._roomWallVisibilityCacheDirty = true;
    }

    private _getWallIndexFromName(name: string): string | null {
      if (!name || !name.startsWith('wall_')) return null;
      return name.slice('wall_'.length);
    }

    private _inferWallNormalLocal(wall: Object3D): Vector3 {
      const mesh = (wall as any).isMesh
        ? wall
        : (wall as any).getObjectByProperty?.('isMesh', true);
      if (!mesh?.geometry?.attributes?.normal?.array) {
        return new Vector3(0, 0, 1);
      }
      const normalAttr = mesh.geometry.attributes.normal
        .array as ArrayLike<number>;
      if (normalAttr.length < 3) return new Vector3(0, 0, 1);
      const normal = new Vector3(normalAttr[0], normalAttr[1], normalAttr[2]);
      if (normal.lengthSq() <= 1e-8) return new Vector3(0, 0, 1);
      if (mesh !== wall) {
        mesh.getWorldQuaternion(this._tmpMeshWorldQuat);
        wall.getWorldQuaternion(this._tmpWallWorldQuat);
        normal
          .normalize()
          .applyQuaternion(this._tmpMeshWorldQuat)
          .applyQuaternion(this._tmpWallWorldQuat.invert());
      }
      return normal.normalize();
    }

    private _rebuildRoomWallVisibilityCache() {
      this._roomWallEntries.clear();
      this._roomAttachedObjectsByWallName.clear();

      const roomObject = this._findRoomSurfaceObject();
      const targetObject = this.findTargetObject();
      if (!roomObject || !targetObject) {
        this._roomWallVisibilityCacheDirty = false;
        return;
      }

      roomObject.traverse((child) => {
        const wallName = child.name || '';
        if (!wallName.startsWith('wall_')) return;
        const wallIndex = this._getWallIndexFromName(wallName);
        const skirtingName = wallIndex != null ? `skirting_${wallIndex}` : '';
        const skirting =
          skirtingName.length > 0
            ? ((child as any).getObjectByName?.(
                skirtingName
              ) as Object3D | null)
            : null;
        this._roomWallEntries.set(wallName, {
          wall: child,
          skirting: skirting || null,
          wallNormalLocal: this._inferWallNormalLocal(child),
        });
      });

      targetObject.traverse((child) => {
        if (child.userData?.isPlacedObject !== true) return;
        const wallName = child.userData?.attachedWallName;
        if (!wallName || typeof wallName !== 'string') return;
        let set = this._roomAttachedObjectsByWallName.get(wallName);
        if (!set) {
          set = new Set<Object3D>();
          this._roomAttachedObjectsByWallName.set(wallName, set);
        }
        set.add(child);
      });

      this._roomFloorAttachedObjects.clear();
      targetObject.traverse((child) => {
        if (child.userData?.isPlacedObject !== true) return;
        if (child.userData?.attachedSurfaceType === 'floor') {
          this._roomFloorAttachedObjects.add(child);
        }
      });

      this._roomWallVisibilityCacheDirty = false;
    }

    private _setWallAttachmentsVisibility(wallName: string, visible: boolean) {
      const attached = this._roomAttachedObjectsByWallName.get(wallName);
      if (attached) {
        attached.forEach((object) => {
          object.visible = visible;
          if (visible) this._roomHiddenAttachedObjects.delete(object);
          else this._roomHiddenAttachedObjects.add(object);
        });
      }

      const wallEntry = this._roomWallEntries.get(wallName);
      if (wallEntry?.skirting) {
        wallEntry.skirting.visible = visible;
        if (visible) this._roomHiddenSkirtings.delete(wallEntry.skirting);
        else this._roomHiddenSkirtings.add(wallEntry.skirting);
      }
    }

    private _resetRoomAttachedVisibility() {
      this._roomHiddenAttachedObjects.forEach((object) => {
        object.visible = true;
      });
      this._roomHiddenSkirtings.forEach((object) => {
        object.visible = true;
      });
      this._roomHiddenAttachedObjects.clear();
      this._roomHiddenSkirtings.clear();
      this._roomWallEntries.clear();
      this._roomAttachedObjectsByWallName.clear();
      this._roomFloorAttachedObjects.clear();
      this._roomWallVisibilityCacheDirty = true;
    }

    private _updateRoomAttachedVisibility() {
      if (!this.srcIsRoom) return;
      const scene = (this as any)[$scene];
      if (!scene) return;
      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return;

      if (this._isRoomWallVisibilityCacheInvalid()) {
        this._roomWallVisibilityCacheDirty = true;
      }
      if (this._roomWallVisibilityCacheDirty) {
        this._rebuildRoomWallVisibilityCache();
      }

      camera.getWorldPosition(this._tmpCameraWorldPos);

      this._roomWallEntries.forEach((entry, wallName) => {
        this._tmpWallWorldNormal
          .copy(entry.wallNormalLocal)
          .transformDirection(entry.wall.matrixWorld)
          .normalize();
        entry.wall.getWorldPosition(this._tmpWallWorldPos);
        this._tmpCameraToWallDir
          .copy(this._tmpWallWorldPos)
          .sub(this._tmpCameraWorldPos);
        if (this._tmpCameraToWallDir.lengthSq() <= 1e-8) {
          this._setWallAttachmentsVisibility(wallName, this.walls);
          return;
        }
        this._tmpCameraToWallDir.normalize();
        const wallBackFacingCamera =
          this._tmpWallWorldNormal.dot(this._tmpCameraToWallDir) >
          ROOM_WALL_BACKFACE_HIDE_THRESHOLD;
        const cameraWantsAttachmentsVisible = !wallBackFacingCamera;
        this._setWallAttachmentsVisibility(
          wallName,
          this.walls && cameraWantsAttachmentsVisible
        );
      });

      this._roomFloorAttachedObjects.forEach((object: Object3D) => {
        const visible = this.floor;
        object.visible = visible;
        if (visible) this._roomHiddenAttachedObjects.delete(object);
        else this._roomHiddenAttachedObjects.add(object);
      });
    }

    private _isRoomWallVisibilityCacheInvalid(): boolean {
      for (const [, entry] of this._roomWallEntries) {
        if (!entry.wall.parent) return true;
        if (entry.skirting && !entry.skirting.parent) return true;
      }
      for (const [, objects] of this._roomAttachedObjectsByWallName) {
        for (const object of objects) {
          if (!object.parent) return true;
        }
      }
      for (const object of this._roomFloorAttachedObjects) {
        if (!object.parent) return true;
      }
      return false;
    }

    private _applySurfaceSnapForNdc(
      object: Object3D,
      ndc: Vector2
    ): SurfaceSnapHit | null {
      const snapPoint = getPrimarySurfaceSnapPoint(object);
      if (!snapPoint) return null;

      const scene = (this as any)[$scene];
      const camera = scene?.getCamera ? scene.getCamera() : scene?.camera;
      const roomObject = this._findRoomSurfaceObject();
      if (!camera || !roomObject) return null;

      const hit = findSurfaceSnapHitForNdc(
        camera,
        ndc,
        roomObject,
        snapPoint,
        object
      );
      if (!hit) return null;

      const floorY = getRoomFloorY(roomObject);
      applySurfaceSnapTransform(object, snapPoint, hit, floorY);
      if (object.userData?.isPlacedObject === true) {
        this._markRoomWallVisibilityCacheDirty();
      }
      this._setPendingSnapConnection(null);
      return hit;
    }

    applySurfaceSnapForPlacement(
      object: Object3D,
      clientX: number,
      clientY: number
    ): SurfaceSnapHit | null {
      const rect = this.getBoundingClientRect();
      const ndc = clientToNdc(clientX, clientY, rect);
      if (!ndc) return null;
      return this._applySurfaceSnapForNdc(object, ndc);
    }

    private _applySurfaceSnapForCurrentMouse(object: Object3D): boolean {
      return !!this._applySurfaceSnapForNdc(object, this.currentMousePosition);
    }

    private _resolvePointerSelectableObject(
      clientX: number,
      clientY: number
    ): Object3D | null {
      const inputEl = (this as any)[$userInputElement];
      if (!inputEl) return null;
      const rect = inputEl.getBoundingClientRect();
      const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      (this as any).currentMousePosition.set(mouseX, mouseY);

      const scene = (this as any)[$scene];
      if (!scene) return null;
      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return null;

      (this as any).raycaster.setFromCamera(
        (this as any).currentMousePosition,
        camera
      );
      const targetObject = (this as any)._findTargetObject();
      if (!targetObject) return null;

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
          hit.object.userData?.isPlacementPlaceholder !== true &&
          hit.object.userData?.selectable !== false
      );
      if (intersects.length === 0) return null;

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

      if (intersectedObject?.userData?.isPlacementPlaceholder === true) {
        return null;
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
      if (objectToSelect == null) return null;
      return (this as any)._isNodeSelectable(objectToSelect)
        ? objectToSelect
        : null;
    }

    private _dispatchHoverChange(hoveredObject: Object3D | null): void {
      if (this._hoveredSelectableObject === hoveredObject) return;
      this._hoveredSelectableObject = hoveredObject;

      if (!hoveredObject) {
        const detail: HoverChangeDetail = {
          hovered: false,
          uuid: '',
          name: '',
          metadata: {},
          anchor: null,
        };
        (this as any).dispatchEvent(
          new CustomEvent('hover-change', {
            detail,
            bubbles: true,
            composed: true,
          })
        );
        return;
      }

      const scene = (this as any)[$scene];
      const camera = scene?.getCamera ? scene.getCamera() : scene?.camera;
      const projectionPayload =
        scene && camera
          ? getObjectAnchorScreenProjection({
              object: hoveredObject,
              camera,
              viewportWidth: scene.width,
              viewportHeight: scene.height,
              sphereCache: this._hoverAnchorSphereCache,
            }).projection
          : null;

      const detail: HoverChangeDetail = {
        hovered: true,
        uuid: hoveredObject.uuid || '',
        name: hoveredObject.name || '',
        metadata: { ...(hoveredObject.userData || {}) },
        anchor: projectionPayload
          ? {
              centerX: projectionPayload.centerX,
              centerY: projectionPayload.centerY,
              radiusPx: Math.round(projectionPayload.radiusPx),
              isVisible: projectionPayload.isVisible,
            }
          : null,
      };

      (this as any).dispatchEvent(
        new CustomEvent('hover-change', {
          detail,
          bubbles: true,
          composed: true,
        })
      );
    }

    private _canShowYRotationControl(): boolean {
      return this.rotationControls && !this.disableYRotationControls;
    }

    private _getRotationDiscTargets(): Object3D[] {
      return this._getSelectedRootObjects();
    }

    private _getRotationDiscFloorY(target: Object3D): number {
      if (this.originalFloorY !== undefined) {
        return this.originalFloorY;
      }
      return target.userData?.isSnappedGroup === true ? target.position.y : 0;
    }

    private _syncRotationControlDiscLifecycle() {
      if (!this._canShowYRotationControl()) {
        this._stopRotationGesture();
        this._disposeRotationControlDisc();
        return;
      }
      const targets = this._getRotationDiscTargets();
      if (targets.length === 0) {
        this._stopRotationGesture();
        this._disposeRotationControlDisc();
        return;
      }
      this._updateRotationPivotFromSelection();
      this._ensureRotationControlDisc();
      const lockKey = targets.map((t) => t.uuid).join(',');
      const lockSize = this._rotationDiscSizeLockedUuid !== lockKey;
      if (lockSize) {
        this._rotationDiscSizeLockedUuid = lockKey;
      }
      const floorY = this._getRotationDiscFloorY(targets[0]);
      this._rotationControlDisc?.update({
        selectedObjects: targets,
        pivotWorld: this._rotationPivotWorld,
        camera: (this as any)[$scene].getCamera
          ? (this as any)[$scene].getCamera()
          : (this as any)[$scene].camera,
        viewportWidth: (this as any)[$scene].width,
        viewportHeight: (this as any)[$scene].height,
        floorY,
        highlightColor: this.highlightColor,
        majorStepDegrees: this.rotationControlsMajorStep,
        fineStepDegrees: this.rotationControlsFineStep,
        lockSize,
      });
      (this as any)[$needsRender]();
    }

    private _ensureRotationControlDisc() {
      if (this._rotationControlDisc) return;
      const scene = (this as any)[$scene];
      // Match grid behavior: attach helpers to scene.target.
      const parent = scene?.target || scene;
      if (!parent) return;
      this._rotationControlDisc = new RotationControlDisc();
      this._rotationControlDisc.userData.noHit = true;
      this._rotationControlDisc.userData.selectable = false;
      parent.add(this._rotationControlDisc);
    }

    private _disposeRotationControlDisc() {
      if (!this._rotationControlDisc) return;
      this._rotationControlDisc.dispose();
      this._rotationControlDisc = null;
      this._rotationDiscSizeLockedUuid = null;
    }

    private _updateRotationControlDisc() {
      if (!this._rotationControlDisc) return;
      const targets = this._getRotationDiscTargets();
      if (targets.length === 0 || !this._canShowYRotationControl()) {
        this._stopRotationGesture();
        this._disposeRotationControlDisc();
        return;
      }
      this._updateRotationPivotFromSelection();
      const scene = (this as any)[$scene];
      const camera = scene?.getCamera ? scene.getCamera() : scene?.camera;
      if (!camera) return;
      this._rotationControlDisc.update({
        selectedObjects: targets,
        pivotWorld: this._rotationPivotWorld,
        camera,
        viewportWidth: scene.width,
        viewportHeight: scene.height,
        floorY: this._getRotationDiscFloorY(targets[0]),
        highlightColor: this.highlightColor,
        majorStepDegrees: this.rotationControlsMajorStep,
        fineStepDegrees: this.rotationControlsFineStep,
        lockSize: false,
      });
    }

    private _setPointerRayFromClient(
      clientX: number,
      clientY: number
    ): boolean {
      const inputEl = (this as any)[$userInputElement];
      const scene = (this as any)[$scene];
      if (!inputEl || !scene) return false;
      const camera = scene.getCamera ? scene.getCamera() : scene.camera;
      if (!camera) return false;
      const rect = inputEl.getBoundingClientRect();
      const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      (this as any).currentMousePosition.set(mouseX, mouseY);
      (this as any).raycaster.setFromCamera(
        (this as any).currentMousePosition,
        camera
      );
      return true;
    }

    private _getRotationPointerAngleRad(
      clientX: number,
      clientY: number
    ): number | null {
      if (!this._rotationControlDisc || !this._rotationControlDisc.visible) {
        return null;
      }
      if (!this._setPointerRayFromClient(clientX, clientY)) {
        return null;
      }
      return this._rotationControlDisc.angleFromRay(
        (this as any).raycaster.ray
      );
    }

    /**
     * Called from the selection mixin so rotation-disc interaction does not
     * clear or replace the current selection on pointerup/pointerdown.
     */
    protected _shouldSkipSelectionPointerEvent(
      e: PointerEvent | MouseEvent
    ): boolean {
      if (
        this._suppressSelectionPointerUp &&
        (e.type === 'pointerup' || e.type === 'click')
      ) {
        return true;
      }
      if (
        this._rotationGestureActive &&
        'pointerId' in e &&
        this._rotationGesturePointerId === (e as PointerEvent).pointerId
      ) {
        return true;
      }
      if (!this._canShowYRotationControl()) {
        return false;
      }
      return (
        this._intersectRotationControlFromClientPoint(
          e.clientX,
          e.clientY
        ) != null
      );
    }

    protected _consumeSelectionPointerSuppression(
      _e: PointerEvent | MouseEvent
    ): void {
      this._suppressSelectionPointerUp = false;
    }

    private _intersectRotationControlFromClientPoint(
      clientX: number,
      clientY: number
    ) {
      if (!this._rotationControlDisc || !this._rotationControlDisc.visible) {
        return null;
      }
      if (!this._setPointerRayFromClient(clientX, clientY)) {
        return null;
      }
      const discHit = this._rotationControlDisc.intersectRay(
        (this as any).raycaster.ray
      );
      if (!discHit) return null;

      const targetObject = (this as any)._findTargetObject();
      if (!targetObject) return null;
      const allHits = (this as any).raycaster.intersectObject(
        targetObject,
        true
      );
      const nearestModelDistance = allHits.find(
        (hit: any) =>
          hit.object.visible &&
          !hit.object.userData?.noHit &&
          !hit.object.userData?.rotationControl
      )?.distance;
      if (
        nearestModelDistance != null &&
        nearestModelDistance + 0.001 < discHit.distance
      ) {
        return null;
      }
      return discHit;
    }

    private _startRotationGesture(e: PointerEvent): boolean {
      const targets = this._getRotationDiscTargets();
      if (targets.length === 0) return false;
      const discHit = this._intersectRotationControlFromClientPoint(
        e.clientX,
        e.clientY
      );
      if (!discHit) return false;
      this._rotationGesturePointerId = e.pointerId;
      this._rotationGestureStartAngleRad = discHit.angleRad;
      this._rotationGestureTargets = targets;
      this._updateRotationPivotFromSelection();
      this._rotationGestureActive = true;
      if (targets.length > 1) {
        this._rotationGestureStartRotationY = 0;
        this._beginSelectionTransformSession(targets, {
          source: 'rotation-disc-y',
          components: ['rotation'],
          axes: { rotation: ['y'] },
        });
      } else {
        const target = targets[0];
        this._rotationGestureStartRotationY =
          this._getRotationFromObject(target)[1];
        this._beginTransformSession(target, {
          source: 'rotation-disc-y',
          components: ['rotation'],
          axes: { rotation: ['y'] },
        });
      }
      this._rotationControlDisc?.setDragArc(discHit.angleRad, discHit.angleRad);
      this._windowPointerMoveForRotationBound =
        this._onWindowPointerMoveForRotation.bind(this);
      this._windowPointerUpForRotationBound =
        this._onWindowPointerUpForRotation.bind(this);
      window.addEventListener(
        'pointermove',
        this._windowPointerMoveForRotationBound,
        true
      );
      window.addEventListener(
        'pointerup',
        this._windowPointerUpForRotationBound,
        true
      );
      window.addEventListener(
        'pointercancel',
        this._windowPointerUpForRotationBound,
        true
      );
      try {
        (this as any)[$controls]?.disableDragInteraction?.();
      } catch (_) {}
      // Treat rotation drag like camera drag so selection pointerup is ignored
      // if it still runs after the gesture ends.
      (this as any)._isDragging = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }

    private _updateRotationGesture(e: PointerEvent): boolean {
      if (
        !this._rotationGestureActive ||
        this._rotationGesturePointerId !== e.pointerId ||
        this._rotationGestureTargets.length === 0
      ) {
        return false;
      }
      const angleRad = this._getRotationPointerAngleRad(e.clientX, e.clientY);
      if (angleRad == null) {
        return true;
      }
      this._rotationControlDisc?.setDragArc(
        this._rotationGestureStartAngleRad,
        angleRad
      );
      const cumulativeRad = -normalizeSignedAngleDelta(
        angleRad - this._rotationGestureStartAngleRad
      );
      const cumulativeDeg = (cumulativeRad * 180) / Math.PI;
      const step = isRotationFineSnapModifierActive(e)
        ? Math.max(0, this.rotationControlsFineStep || 0)
        : Math.max(0, this.rotationControlsMajorStep || 0);
      const rawTargetY = this._rotationGestureStartRotationY + cumulativeDeg;
      const targetY =
        step > 0 ? snapRotationYToStepGrid(rawTargetY, step) : rawTargetY;

      const targets = this._rotationGestureTargets;
      if (targets.length > 1) {
        const session = this._selectionTransformSession;
        if (session?.source === 'rotation-disc-y') {
          const applyDeltaDeg = targetY - session.gestureRotationYDelta;
          if (Math.abs(applyDeltaDeg) > 1e-4) {
            session.gestureRotationYDelta = targetY;
            session.gestureDelta.rotation[1] = normalizeAngleDeltaDeg(targetY);
            this._applyRotationDeltaYAroundPivot(
              targets,
              session.startPivotPosition,
              applyDeltaDeg
            );
            this._emitSelectionTransformUpdate();
          }
        }
      } else {
        const target = targets[0];
        const currentY = this._getRotationFromObject(target)[1];
        const applyDeltaDeg = targetY - currentY;
        if (Math.abs(applyDeltaDeg) > 1e-4) {
          this._applyRotationDeltaYAroundPivot(
            [target],
            this._rotationPivotWorld,
            applyDeltaDeg
          );
          const session = this._transformSessions.get(target);
          if (session?.source === 'rotation-disc-y') {
            session.gestureRotationYDelta += applyDeltaDeg;
          }
          this._emitTransformUpdate(target);
        }
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }

    private _stopRotationGesture() {
      if (!this._rotationGestureActive) return;
      const targets = this._rotationGestureTargets;
      this._suppressSelectionPointerUp = true;
      this._rotationGestureActive = false;
      this._rotationGesturePointerId = null;
      this._rotationGestureStartAngleRad = 0;
      this._rotationGestureStartRotationY = 0;
      this._rotationGestureTargets = [];
      if (targets.length > 1) {
        this._endSelectionTransformSession();
      } else if (targets.length === 1) {
        this._endTransformSession(targets[0]);
      }
      this._rotationControlDisc?.clearDragArc();
      if (this._windowPointerMoveForRotationBound) {
        window.removeEventListener(
          'pointermove',
          this._windowPointerMoveForRotationBound,
          true
        );
        this._windowPointerMoveForRotationBound = undefined;
      }
      if (this._windowPointerUpForRotationBound) {
        window.removeEventListener(
          'pointerup',
          this._windowPointerUpForRotationBound,
          true
        );
        window.removeEventListener(
          'pointercancel',
          this._windowPointerUpForRotationBound,
          true
        );
        this._windowPointerUpForRotationBound = undefined;
      }
      try {
        (this as any)[$controls]?.enableDragInteraction?.();
      } catch (_) {}
      (this as any)._isDragging = false;
      this._updateRotationPivotFromSelection();
      try {
        this._updateRotationControlDisc();
      } catch (_) {}
      queueMicrotask(() => {
        this._suppressSelectionPointerUp = false;
      });
    }

    private _onWindowPointerMoveForRotation(e: PointerEvent) {
      this._updateRotationGesture(e);
    }

    private _onWindowPointerUpForRotation(e: PointerEvent) {
      if (
        this._rotationGestureActive &&
        this._rotationGesturePointerId === e.pointerId
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this._stopRotationGesture();
      }
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

      // When editMode is on, disable orbit/pan (not zoom) while pointer is over a selectable
      // object so click/drag doesn't orbit. We disable on pointermove (over selectable) so we're
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
        this._dispatchHoverChange(null);
        this._removeWindowDragListeners();
      } catch (e) {}
    }

    /**
     * Disable orbit/pan when pointer moves over a selectable (so we're disabled before pointerdown).
     * Wheel/pinch zoom stays enabled. Re-enable drag when pointer leaves selectable.
     * Do not disable when user is dragging the camera (pointer went down on empty space).
     * Throttled to one raycast per frame for performance in large scenes.
     */
    private _onPointerMoveCapture(e: PointerEvent) {
      if (this._updateRotationGesture(e)) {
        return;
      }
      if (!this.editMode || !(this as any)[$controls]) return;
      if (this._placementDisablesCameraDrag) return;
      if ((this as any).isDragging) return;
      if (this._pointerDownOnSelectable === false) return;

      this._pendingPointerMove = { clientX: e.clientX, clientY: e.clientY };
      if (this._pointerMoveOverSelectableRaf !== 0) return;

      this._pointerMoveOverSelectableRaf = requestAnimationFrame(() => {
        this._pointerMoveOverSelectableRaf = 0;
        const p = this._pendingPointerMove;
        this._pendingPointerMove = null;
        if (!p || !this.editMode || !(this as any)[$controls]) return;
        if (this._placementDisablesCameraDrag) return;
        if ((this as any).isDragging) return;
        if (this._pointerDownOnSelectable === false) return;

        const hoveredObject = this._resolvePointerSelectableObject(
          p.clientX,
          p.clientY
        );
        const overSelectable = hoveredObject != null;
        this._dispatchHoverChange(hoveredObject);
        this._setPointerHoverCameraDragDisabled(overSelectable);
      });
    }

    private _onPointerDownCapture(e: PointerEvent) {
      if (e.button !== 0) return;
      if ((this as any)._isUIElement(e.target)) return;
      if (this._canShowYRotationControl() && this._startRotationGesture(e)) {
        return;
      }
      if (!this.editMode) return;
      if (!(this as any)[$controls]) return;
      if (this._placementDisablesCameraDrag) return;
      const hoveredObject = this._resolvePointerSelectableObject(
        e.clientX,
        e.clientY
      );
      const overSelectable = hoveredObject != null;
      this._pointerDownOnSelectable = overSelectable;
      if (!overSelectable) {
        this._dispatchHoverChange(null);
      }
      if (!overSelectable) return;
      this._setPointerHoverCameraDragDisabled(true);
    }

    private _onPointerUpCapture(e: PointerEvent) {
      if (
        this._rotationGestureActive &&
        this._rotationGesturePointerId === e.pointerId
      ) {
        this._stopRotationGesture();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      this._pointerDownOnSelectable = null;
      if (this._placementDisablesCameraDrag) return;
      if ((this as any).isDragging) return;
      const hoveredObject = this._resolvePointerSelectableObject(
        e.clientX,
        e.clientY
      );
      this._dispatchHoverChange(hoveredObject);
      this._setPointerHoverCameraDragDisabled(hoveredObject != null);
    }

    private onMouseDown(event: MouseEvent) {
      if (this._rotationGestureActive) {
        return;
      }
      if ((this as any)._isInteractivePlacementActive?.()) {
        return;
      }
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

      // Shift-click toggles selection; don't start a drag that swallows pointerup.
      if ((this as any)._isMultiSelectModifierActive?.(event)) {
        return;
      }

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
      if ((this as any)._isInteractivePlacementActive?.()) return;

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        this.updateMousePositionFromTouch(touch);

        if ((this as any)._isMultiSelectModifierActive?.(event)) {
          return;
        }

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

    private _resolveDragRoots(): Object3D[] {
      const selected = (
        ((this as any).selectedObjects || []) as Object3D[]
      ).filter(Boolean);
      if (selected.length === 0) return [];

      if ((this as any).selectionScope === 'part') {
        return this._getSelectedRootObjects();
      }

      const roots: Object3D[] = [];
      const seen = new Set<string>();
      for (const obj of selected) {
        const root =
          (this as any)._findEnclosingGroup(obj) || obj;
        if (!seen.has(root.uuid)) {
          seen.add(root.uuid);
          roots.push(root);
        }
      }
      return roots;
    }

    private startDragging(_event?: MouseEvent | TouchEvent) {
      if ((this as any)._isInteractivePlacementActive?.()) {
        return;
      }
      if (!(this as any).selectedObjects.length) {
        return;
      }

      const roots = this._resolveDragRoots();
      if (roots.length === 0) return;

      this._dragTargets = roots;
      this._dragStartPositions.clear();
      this._dragOffsets.clear();

      (this as any).isDragging = true;

      const anySurfaceSnap = roots.some((obj) => requiresSurfaceSnap(obj));
      const positionAxes: TransformAxis[] = anySurfaceSnap
        ? ['x', 'y', 'z']
        : ['x', 'z'];

      if (roots.length > 1) {
        this._beginSelectionTransformSession(roots, {
          source: 'pointer-drag',
          components: ['position'],
          axes: { position: positionAxes },
        });
      } else {
        this._beginTransformSession(roots[0], {
          source: 'pointer-drag',
          components: ['position'],
          axes: { position: positionAxes },
        });
      }

      this.dragStartMousePosition.copy(this.currentMousePosition);
      this.dragStartPosition.copy(roots[0].position);

      (this as any).raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      if (this.originalFloorY !== undefined) {
        this.floorPlane.constant = -this.originalFloorY;
      }

      const clickPoint = new Vector3();
      const hasFloorHit = (this as any).raycaster.ray.intersectPlane(
        this.floorPlane,
        clickPoint
      );

      for (const target of roots) {
        this._dragStartPositions.set(target.uuid, target.position.clone());
        if (hasFloorHit) {
          target.updateMatrixWorld(true);
          target.getWorldPosition(this._tmpDragWorldPos);
          this._dragOffsets.set(
            target.uuid,
            new Vector3(
              this._tmpDragWorldPos.x - clickPoint.x,
              0,
              this._tmpDragWorldPos.z - clickPoint.z
            )
          );
        } else {
          this._dragOffsets.set(target.uuid, new Vector3(0, 0, 0));
        }
      }

      const primaryOffset = this._dragOffsets.get(roots[0].uuid);
      this.dragOffset.copy(primaryOffset ?? new Vector3(0, 0, 0));

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

    private _updateSelectionDragGestureDelta() {
      const session = this._selectionTransformSession;
      if (!session) return;
      this._updateRotationPivotFromSelection();
      session.gestureDelta.position[0] =
        this._rotationPivotWorld.x - session.startPivotPosition.x;
      session.gestureDelta.position[1] =
        this._rotationPivotWorld.y - session.startPivotPosition.y;
      session.gestureDelta.position[2] =
        this._rotationPivotWorld.z - session.startPivotPosition.z;
      this._emitSelectionTransformUpdate();
    }

    private updateDragPosition() {
      if (
        !(this as any).isDragging ||
        (this as any).selectedObjects.length === 0 ||
        this._dragTargets.length === 0
      )
        return;

      (this as any).raycaster.setFromCamera(
        this.currentMousePosition,
        (this as any)[$scene].camera
      );

      const intersectionPoint = new Vector3();
      const hasFloorHit = (this as any).raycaster.ray.intersectPlane(
        this.floorPlane,
        intersectionPoint
      );

      let allSurfaceSnapValid = true;

      for (const object of this._dragTargets) {
        const isSurfaceSnapObject = requiresSurfaceSnap(object);
        if (isSurfaceSnapObject) {
          const valid = this._applySurfaceSnapForCurrentMouse(object);
          if (!valid) {
            allSurfaceSnapValid = false;
            continue;
          }
          if (this._dragTargets.length === 1) {
            this._emitTransformUpdate(object);
          }
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
          continue;
        }

        if (!hasFloorHit) continue;

        const offset =
          this._dragOffsets.get(object.uuid) ?? this.dragOffset;

        object.updateMatrixWorld(true);
        object.getWorldPosition(this._tmpDragWorldPos);
        this._tmpDragDesiredLocal.set(
          intersectionPoint.x + offset.x,
          this._tmpDragWorldPos.y,
          intersectionPoint.z + offset.z
        );
        if (object.parent) {
          object.parent.worldToLocal(this._tmpDragDesiredLocal);
        }

        const desiredY =
          object.userData?.isSnappedGroup === true
            ? object.position.y
            : this.originalFloorY || 0;

        object.position.set(
          this._tmpDragDesiredLocal.x,
          desiredY,
          this._tmpDragDesiredLocal.z
        );

        this._setPendingSnapConnection(null);
        if (this.snappingEnabled) {
          this.checkAndApplySnapping(object, intersectionPoint);
        }

        if (this._dragTargets.length === 1) {
          this._emitTransformUpdate(object);
        }

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

      if (!allSurfaceSnapValid) {
        return;
      }

      if (this._dragTargets.length > 1) {
        this._updateSelectionDragGestureDelta();
      }

      this.requestShadowUpdate();
      (this as any)[$needsRender]();
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}
    }

    private stopDragging() {
      if (!(this as any).isDragging) {
        return;
      }

      const dragTargets = [...this._dragTargets];
      this._removeWindowDragListeners();
      (this as any).isDragging = false;

      if ((this as any).selectionScope === 'part') {
        for (const draggedObject of dragTargets) {
          try {
            if (draggedObject && !draggedObject.userData?.isSnappedGroup) {
              draggedObject.userData = draggedObject.userData || {};
              draggedObject.userData.isPlacedObject = true;

              const isPartOfGroup =
                draggedObject.parent?.userData?.isSnappedGroup === true;

              if (!isPartOfGroup) {
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
                      { e }
                    );
                  }
                }
              }
            }
          } catch (e) {
            (this as any).log(
              '[puzzler] error ensuring part placement status',
              { e }
            );
          }
        }
      }

      this._recentlyDisconnectedPairs.clear();

      this._dragTargets = [];
      this._dragStartPositions.clear();
      this._dragOffsets.clear();

      if (this.pendingSnapConnection) {
        try {
          this.completeSnapConnection(this.pendingSnapConnection);
        } catch (e) {}
        this.pendingSnapConnection = null;
      }

      if (dragTargets.length > 1) {
        this._endSelectionTransformSession();
      } else if (dragTargets.length === 1) {
        this._endTransformSession(dragTargets[0]);
      }

      for (const dragTarget of dragTargets) {
        if (dragTarget.userData?.isPlacedObject === true) {
          this._markRoomWallVisibilityCacheDirty();
        }
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
          if (child.userData.isPlacedObject && child.userData.snapPoints)
            snappableObjects.push(child);
        });
      } else if (draggedObject.userData.snapPoints) {
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
            child.userData.snapPoints
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

            const connections = findSnappingConnections(
              snappableObj,
              child,
              (object, snapPoint) => this.isSnapPointUsed(object, snapPoint)
            );

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

        const beforeNodes = this._collectStructureNodes(selectedGroup);

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
          const childrenBeforeUngroup = [...selectedGroup.children];
          try {
            try {
              (this as any).log(
                '[puzzler] breakSpecificConnection: no connections remain — ungrouping',
                {
                  group: selectedGroup.name || selectedGroup.uuid,
                }
              );
            } catch (e) {}

            const ungrouped = this.ungroupSnappedGroup(selectedGroup, {
              skipHistory: true,
            });
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
            this._recordStructureChange(
              beforeNodes,
              this._collectStructureNodes(...childrenBeforeUngroup),
              'Break link'
            );
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

        this._recordStructureChange(
          beforeNodes,
          this._collectStructureNodes(selectedGroup),
          'Break link'
        );

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
      const hadSelection = (this as any).selectedObjects.length > 0;

      try {
        (this as any)[$clearSelectedObject]();
        this._breakLinkSlotsVisible = false;
        this.clearSlots(this._breakLinkSlots);
      } catch (e) {
        (this as any).error('[puzzler] clearSelection error:', e);
      }

      (this as any).selectedObjects = [];
      (this as any)._selectedGroups.clear();

      if ((this as any).highlightSelected) {
        (this as any)._updateHighlight();
      }

      if (hadSelection) {
        (this as any)._dispatchSelectionChange('clear');
      }

      (this as any)[$needsRender]();
    }

    /**
     * Delete a specific node
     */
    private _purgeSelectionForDeletedNode(node: Object3D) {
      const selected = (
        ((this as any).selectedObjects || []) as Object3D[]
      ).filter(Boolean);
      for (const sel of selected) {
        if (sel === node) {
          (this as any)._removeFromSelection(sel);
          continue;
        }
        let parent: Object3D | null = sel.parent;
        while (parent) {
          if (parent === node) {
            (this as any)._removeFromSelection(sel);
            break;
          }
          parent = parent.parent;
        }
      }
    }

    deleteNode(node: Object3D): boolean {
      if (!node) return false;
      try {
        this._purgeSelectionForDeletedNode(node);

        if (!this._ensureUndoHistory().isReplaying) {
          const detached = this._ensureUndoHistory().detachToGraveyard(
            node,
            ((this as any).selectedObjects || []).map((o: Object3D) => o.uuid)
          );
          this._firePartsStateEvents(node, 'delete', {});
          this._dispatchObjectRemoveEvent(node);
          this._ensureUndoHistory().recordRemove([detached]);
          (this as any)[$needsRender]();
          return true;
        }

        // Fire events for individual parts before deletion
        this._firePartsStateEvents(node, 'delete', {});

        if (node.parent) {
          this._dispatchObjectRemoveEvent(node);
          node.parent.remove(node);
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
        if (group && (this as any).selectedObjects.includes(group)) {
          (this as any)._removeFromSelection(group);
        } else if ((this as any).selectedObjects.includes(obj)) {
          (this as any)._removeFromSelection(obj);
        }
        this._purgeSelectionForDeletedNode(obj);

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
            this.deleteNode(obj);
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
     * Merge options for a coalesced remove pass (animate wins if any caller requests it).
     */
    private _mergeRemoveSelectedCoalescedOptions(next?: {
      animate?: boolean;
    }): void {
      if (!next || next.animate !== true) return;
      if (!this._removeSelectedMergedOptions) {
        this._removeSelectedMergedOptions = {};
      }
      this._removeSelectedMergedOptions.animate = true;
    }

    private _normalizeDeletionRoots(selected: Object3D[]): Object3D[] {
      const selectedSet = new Set<Object3D>(selected);
      let nodes = [...selected];

      if ((this as any).selectionScope === 'part') {
        const groupsToPromote = new Set<Object3D>();
        const targetObject = (this as any)._findTargetObject?.() as
          | Object3D
          | null;
        if (targetObject) {
          targetObject.traverse((child: any) => {
            if (child.userData?.isSnappedGroup !== true) return;
            const parts: Object3D[] = [];
            child.traverse((part: any) => {
              if (part !== child && part.userData?.isPlacedObject === true) {
                parts.push(part);
              }
            });
            if (
              parts.length > 0 &&
              parts.every((part) => selectedSet.has(part))
            ) {
              groupsToPromote.add(child);
            }
          });
        }

        if (groupsToPromote.size > 0) {
          nodes = nodes.filter((node) => {
            if (groupsToPromote.has(node)) return true;
            let parent: Object3D | null = node.parent;
            while (parent) {
              if (groupsToPromote.has(parent)) return false;
              parent = parent.parent;
            }
            return true;
          });
          for (const group of groupsToPromote) {
            if (!nodes.includes(group)) {
              nodes.push(group);
            }
          }
        }
      }

      const nodeSet = new Set<Object3D>(nodes);
      return nodes.filter((node) => {
        let parent: Object3D | null = node.parent as Object3D | null;
        while (parent) {
          if (nodeSet.has(parent)) return false;
          parent = parent.parent as Object3D | null;
        }
        return true;
      });
    }

    private _flushRemoveSelectedObjects(options?: { animate?: boolean }) {
      try {
        const selected = (
          ((this as any).selectedObjects || []) as Object3D[]
        ).filter(Boolean);
        if (selected.length === 0) return;

        const roots = this._normalizeDeletionRoots(selected);

        // Clear selection first so controls/UI do not hold stale references.
        (this as any).clearSelection();

        const history = this._ensureUndoHistory();
        const shouldBatch = roots.length > 1 && !history.isReplaying;
        if (shouldBatch) {
          history.beginBatch();
        }

        const scene = (this as any)[$scene];
        try {
          for (const node of roots) {
            if (!node) continue;
            // removeObject resolves by name; only use it when the name maps back
            // to this exact node to avoid deleting a same-named sibling.
            if (node.name && scene?.getObjectByName(node.name) === node) {
              this.removeObject(node.name, options);
            } else {
              this.deleteNode(node);
            }
          }
        } finally {
          if (shouldBatch) {
            history.endBatch(`Delete ${roots.length} objects`);
          }
        }
      } catch (e) {
        // swallow
      }
    }

    /**
     * Remove currently selected objects/groups.
     * Handles single and multi-selection and avoids duplicate removals when
     * both a parent group and its child are selected.
     *
     * Multiple synchronous calls (e.g. host window listener and the element's
     * own keydown) are coalesced into one removal pass in the same task via a
     * microtask; options are merged so `animate: true` wins if any caller set it.
     */
    removeSelectedObjects(options?: { animate?: boolean }) {
      this._mergeRemoveSelectedCoalescedOptions(options);
      if (this._removeSelectedFlushScheduled) return;
      this._removeSelectedFlushScheduled = true;
      queueMicrotask(() => {
        this._removeSelectedFlushScheduled = false;
        const merged = this._removeSelectedMergedOptions;
        this._removeSelectedMergedOptions = undefined;
        if (!this.isConnected) return;
        this._flushRemoveSelectedObjects(merged);
      });
    }

    /**
     * Group selected objects together (creates a new group from multiple objects)
     */
    groupSelectedObjects(): Object3D | null {
      if ((this as any).selectedObjects.length < 2) return null;

      try {
        const selected = [...((this as any).selectedObjects as Object3D[])];
        const beforeNodes = this._collectStructureNodes(...selected);
        const count = selected.length;

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

        this._recordStructureChange(
          beforeNodes,
          this._collectStructureNodes(group),
          `Group ${count} objects`
        );

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
      this.cancelPaste();
      if (
        this._activePlacementSession &&
        this._activePlacementSession.state === 'placing'
      ) {
        return this._activePlacementSession;
      }

      try {
        (this as any).clearSelection?.();
      } catch (e) {}

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
      this._setPlacementCameraDragDisabled(true);
      this._syncCursorLifecycle();

      // Ensure snapping slots are refreshed immediately when an interactive
      // placement session is started so snapping points for the placeholder
      // will appear (placeholder may not yet be loaded).
      try {
        this.updateSnappingPointSlots();
      } catch (e) {}

      // Keep session through commit + follow-up click (state loading); clear on end.
      const endPlacementSession = () => {
        if (this._activePlacementSession === session) {
          this._activePlacementSession = null;
        }
        this._setPlacementCameraDragDisabled(false);
        this._syncCursorLifecycle();
      };

      session.addEventListener('loaded', endPlacementSession, { once: true });
      session.addEventListener('cancel', endPlacementSession, { once: true });
      session.addEventListener('error', endPlacementSession, { once: true });

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
      let pendingPointerMove: { clientX: number; clientY: number } | null =
        null;
      let pointerMoveRaf = 0;

      // Wire default pointer capture (window-level) so consumers don't need to
      // manage global listeners. Pointer moves update the placeholder; pointer
      // up commits the placement. ESC cancels.
      const flushPointerMove = () => {
        pointerMoveRaf = 0;
        const pending = pendingPointerMove;
        pendingPointerMove = null;
        if (!pending) return;
        try {
          if (session.state === 'placing') {
            session.updatePosition(pending.clientX, pending.clientY);
          }
        } catch (err) {
          // swallow
        }
      };

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
            pendingPointerMove = { clientX: e.clientX, clientY: e.clientY };
            if (pointerMoveRaf === 0) {
              pointerMoveRaf = requestAnimationFrame(flushPointerMove);
            }
          }
        } catch (err) {
          // swallow
        }
      };

      const onPointerUp = (e: PointerEvent) => {
        try {
          if (session.state === 'placing') {
            const requiresWallSurfaceSnap =
              (session as any).requiresSurfaceSnap?.() ?? false;
            const hasValidWallSurfaceSnap =
              (session as any).hasValidSurfaceSnap?.() ?? false;
            if (requiresWallSurfaceSnap && !hasValidWallSurfaceSnap) {
              session.cancel();
              return;
            }

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
        if (pointerMoveRaf !== 0) {
          cancelAnimationFrame(pointerMoveRaf);
          pointerMoveRaf = 0;
        }
        pendingPointerMove = null;
        this._setPlacementCameraDragDisabled(false);
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
      // slot renderer sees placeholder snapPoints during interactive
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
            if (requiresSurfaceSnap(ph)) return;
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
     * Look up a placed object in the scene by its Three.js UUID.
     *
     * @param objectUuid - The UUID of the object to retrieve
     * @returns The Object3D if found, otherwise null
     */
    getPart(objectUuid: string): Object3D | null {
      if (!objectUuid) {
        throw new Error('objectUuid is required');
      }

      const scene = (this as any)[$scene];
      if (!scene) {
        throw new Error('Scene not available');
      }

      return (
        (scene.getObjectByProperty('uuid', objectUuid) as
          | Object3D
          | undefined) ?? null
      );
    }

    getClipboardState(): ClipboardState {
      const entry = this._clipboardEntry;
      const pasteSession = this._activePasteSession;
      return {
        hasClipboard: !!entry,
        entry: entry ? toClipboardStateEntry(entry) : undefined,
        pasteSession: pasteSession
          ? {
              active:
                pasteSession.state === 'previewing' ||
                pasteSession.state === 'committing',
              state:
                pasteSession.state === 'committing'
                  ? 'committing'
                  : 'previewing',
              validTarget: pasteSession.hasValidSurfaceSnap,
            }
          : undefined,
      };
    }

    private _emitClipboardChange(reason: ClipboardChangeReason): void {
      try {
        (this as any).dispatchEvent(
          new CustomEvent<ClipboardChangeDetail>('clipboard-change', {
            detail: {...this.getClipboardState(), reason},
          })
        );
      } catch (_e) {}
    }

    private _resolveCopyTargets(objectUuid?: string): Object3D[] {
      const selected = [
        ...(((this as any).selectedObjects as Object3D[]) || []),
      ];
      const selectedRoots = this._normalizeDeletionRoots(selected).filter(
        (node) => isClipboardCopyTarget(node)
      );

      if (objectUuid) {
        const matchesSelection = selectedRoots.some(
          (node) => node.uuid === objectUuid
        );
        if (matchesSelection && selectedRoots.length > 0) {
          return selectedRoots;
        }

        const node = this.getPart(objectUuid);
        return isClipboardCopyTarget(node) ? [node] : [];
      }

      return selectedRoots;
    }

    private _cancelActivePlacementForPaste(): void {
      const session = this._activePlacementSession;
      if (session && session.state === 'placing') {
        try {
          session.cancel();
        } catch (_e) {}
      }
    }

    private _teardownPastePointerListeners(): void {
      if (this._pastePointerTeardown) {
        try {
          this._pastePointerTeardown();
        } catch (_e) {}
        this._pastePointerTeardown = null;
      }
    }

    private _endActivePasteSession(): void {
      if (this._activePasteSession === null) return;
      this._teardownPastePointerListeners();
      try {
        this._activePasteSession.dispose();
      } catch (_e) {}
      this._activePasteSession = null;
      this._setPlacementCameraDragDisabled(false);
      this._syncCursorLifecycle();
    }

    cancelPaste(): void {
      const session = this._activePasteSession;
      if (!session) return;
      session.cancel();
      this._endActivePasteSession();
    }

    clearClipboard(): void {
      this.cancelPaste();
      if (this._clipboardEntry) {
        disposeClipboardEntry(this._clipboardEntry);
        this._clipboardEntry = null;
      }
      this._emitClipboardChange('clear');
    }

    copyPart(
      objectUuid?: string,
      options?: CopyPartOptions
    ): PasteSession | void {
      const targets = this._resolveCopyTargets(objectUuid);
      if (targets.length === 0) return;

      this._cancelActivePlacementForPaste();
      this.cancelPaste();

      if (this._clipboardEntry) {
        disposeClipboardEntry(this._clipboardEntry);
      }
      const entry = snapshotClipboardTargets(targets);
      if (!entry) return;
      this._clipboardEntry = entry;
      this._emitClipboardChange('copy');

      if (!options?.interactive) return;

      try {
        (this as any).clearSelection?.();
      } catch (_e) {}

      const session = new PasteSession(this as unknown as PasteSessionHost, entry);
      this._activePasteSession = session;
      this._setPlacementCameraDragDisabled(true);
      this._syncCursorLifecycle();
      session.createGhost();
      const seedMouse =
        options.initialMouse ??
        (this._lastCursorClient
          ? {
              clientX: this._lastCursorClient.clientX,
              clientY: this._lastCursorClient.clientY,
            }
          : undefined);
      if (seedMouse) {
        try {
          session.updatePosition(seedMouse.clientX, seedMouse.clientY);
        } catch (_e) {}
      }
      this._wirePasteSessionPointers(session, seedMouse);
      this._emitClipboardChange('paste-start');
      return session;
    }

    async paste(options?: PasteOptions): Promise<PasteResult | null> {
      const entry = this._clipboardEntry;
      if (!entry) return null;

      const clientX = options?.clientX ?? this._lastCursorClient?.clientX;
      const clientY = options?.clientY ?? this._lastCursorClient?.clientY;
      if (clientX === undefined || clientY === undefined) return null;

      const scene = (this as any)[$scene];
      const parent = scene?.target || scene;
      if (!parent) return null;

      const sessionId = createSessionId();
      const commits = commitPasteTargets(entry, sessionId);
      if (commits.length === 0) return null;

      const selectionItems = getSelectionClipboardItems(entry);
      const leaderIndex = getSelectionLeaderIndex(entry);
      const leader = commits[leaderIndex]?.node ?? commits[0].node;
      const placementItems = commits.map((commit, index) => ({
        object: commit.node,
        requiresSurfaceSnap: commit.itemEntry.requiresSurfaceSnap,
        anchorOffset: selectionItems[index]?.anchorOffset.clone() ?? new Vector3(),
      }));

      const pose =
        placementItems.length > 1
          ? applySelectionPointerPlacementPose(
              this as any,
              leader,
              placementItems,
              clientX,
              clientY
            )
          : applyPointerPlacementPose(
              this as any,
              leader,
              clientX,
              clientY
            );

      if (!pose.worldPoint) return null;
      if (entryRequiresSurfaceSnap(entry) && !pose.hasValidSurfaceSnap) {
        return null;
      }

      try {
        for (const {node} of commits) {
          parent.add(node);
        }
      } catch (_e) {
        return null;
      }

      const selectPasted = options?.select === true;

      if (commits.length > 1) {
        return this._finalizePasteCommitMany(commits, {
          select: selectPasted,
        });
      }

      return this._finalizePasteCommit(commits[0].node, commits[0].itemEntry, {
        select: selectPasted,
      });
    }

    private _finalizePasteCommitMany(
      commits: Array<{node: Object3D; itemEntry: ClipboardEntry}>,
      options?: {select?: boolean; emitChange?: boolean}
    ): PasteCommitResult {
      const history = this._ensureUndoHistory();
      const shouldBatch = commits.length > 1 && !history.isReplaying;
      if (shouldBatch) {
        history.beginBatch();
      }

      for (const commit of commits) {
        this._finalizePasteCommit(commit.node, commit.itemEntry, {
          select: false,
          emitChange: false,
        });
      }

      if (shouldBatch) {
        history.endBatch('Paste selection');
      }

      const select = options?.select !== false;
      if (select) {
        try {
          (this as any)._replaceSelection?.(commits.map((commit) => commit.node));
        } catch (_e) {}
      }

      try {
        (this as any)[$needsRender]();
      } catch (_e) {}

      if (options?.emitChange !== false) {
        this._emitClipboardChange('paste-commit');
      }

      return {
        id: commits[0].node.name,
        node: commits[0].node,
        nodes: commits.map((commit) => commit.node),
      };
    }

    private _finalizePasteCommit(
      node: Object3D,
      entry: ClipboardEntry,
      options?: {select?: boolean; emitChange?: boolean}
    ): PasteCommitResult {
      try {
        this._markRoomWallVisibilityCacheDirty();
      } catch (_e) {}

      if (entry.kind === 'group') {
        try {
          this.updateGroupMeshCache(node);
        } catch (_e) {}
        this._recordStructureChange([], this._collectStructureNodes(node), 'Paste group');
      } else {
        this._recordPlacementAdd(node);
      }

      this._firePartsStateEvents(node, 'paste', {});

      const select = options?.select !== false;
      if (select) {
        try {
          if (entry.kind === 'group') {
            (this as any).selectGroup?.(node);
          } else {
            (this as any).selectPart?.(node);
          }
        } catch (_e) {}
      }

      try {
        (this as any)[$needsRender]();
      } catch (_e) {}

      if (options?.emitChange !== false) {
        this._emitClipboardChange('paste-commit');
      }

      return {
        id: node.name,
        node,
      };
    }

    private _wirePasteSessionPointers(
      session: PasteSession,
      initialMouse?: { clientX: number; clientY: number }
    ): void {
      this._teardownPastePointerListeners();

      const DRAG_THRESHOLD_PX = 10;
      let startClientX: number | null = initialMouse?.clientX ?? null;
      let startClientY: number | null = initialMouse?.clientY ?? null;
      let maxDistanceSq = 0;
      let pointerMoveRaf = 0;
      let pendingPointerMove: { clientX: number; clientY: number } | null = null;
      let placementPointerId: number | null = null;
      let suppressPointerUpUntil = 0;

      const isPointerInViewer = (clientX: number, clientY: number) => {
        const inputEl = (this as any)[$userInputElement] as
          | HTMLElement
          | undefined;
        if (!inputEl) return false;
        const rect = inputEl.getBoundingClientRect();
        return (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        );
      };

      const flushPointerMove = () => {
        pointerMoveRaf = 0;
        const pending = pendingPointerMove;
        pendingPointerMove = null;
        if (!pending || session.state !== 'previewing') return;
        session.updatePosition(pending.clientX, pending.clientY);
      };

      const onPointerDown = (e: PointerEvent) => {
        if (session.state !== 'previewing') return;
        if (!isPointerInViewer(e.clientX, e.clientY)) return;
        placementPointerId = e.pointerId;
        startClientX = e.clientX;
        startClientY = e.clientY;
        maxDistanceSq = 0;
        session.updatePosition(e.clientX, e.clientY);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (session.state !== 'previewing') return;
        if (!isPointerInViewer(e.clientX, e.clientY)) return;
        if (placementPointerId !== null && e.pointerId !== placementPointerId) {
          return;
        }
        if (startClientX === null || startClientY === null) {
          startClientX = e.clientX;
          startClientY = e.clientY;
        }
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        maxDistanceSq = Math.max(maxDistanceSq, dx * dx + dy * dy);
        pendingPointerMove = {clientX: e.clientX, clientY: e.clientY};
        if (!pointerMoveRaf) {
          pointerMoveRaf = requestAnimationFrame(flushPointerMove);
        }
      };

      const onPointerUp = (e: PointerEvent) => {
        if (session.state !== 'previewing') return;
        if (performance.now() < suppressPointerUpUntil) return;
        if (placementPointerId === null || e.pointerId !== placementPointerId) {
          return;
        }
        placementPointerId = null;
        flushPointerMove();
        if (maxDistanceSq <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          session.updatePosition(e.clientX, e.clientY);
        }
        const result = session.commit({select: true, emitChange: false});
        this._endActivePasteSession();
        if (result) {
          this._emitClipboardChange('paste-commit');
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        session.cancel();
        this._endActivePasteSession();
      };

      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('keydown', onKeyDown);

      // Ignore the pointerup from the Duplicate button click that started the session.
      suppressPointerUpUntil = performance.now() + 300;

      this._pastePointerTeardown = () => {
        window.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        if (pointerMoveRaf) {
          cancelAnimationFrame(pointerMoveRaf);
          pointerMoveRaf = 0;
        }
      };

      if (initialMouse) {
        try {
          session.updatePosition(initialMouse.clientX, initialMouse.clientY);
        } catch (_e) {}
      } else if (this._lastCursorClient) {
        try {
          session.updatePosition(
            this._lastCursorClient.clientX,
            this._lastCursorClient.clientY
          );
        } catch (_e) {}
      }
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

      if (options?.selection) {
        newObject.userData.selection = options.selection;
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
      newObject.userData.selectable = getPlacementSelectable(options);
      if (options?.editable !== undefined) {
        newObject.userData.editable = options.editable;
      }
      const replacementSnapPoints = getPlacementSnapPoints(options);
      if (replacementSnapPoints) {
        newObject.userData.snapPoints = replacementSnapPoints;
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
  private _hasValidSurfaceSnap: boolean = false;

  constructor(
    element: any,
    log: LogFunction,
    warn?: WarnFunction,
    error?: ErrorFunction,
    lowResSrc?: string,
    highResSrc?: string,
    options?: PlacementOptions,
    _immediatePlacement = false
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

  private _getWallCursorPointFromPlaceholder(
    surfaceHit: SurfaceSnapHit
  ): Vector3 | null {
    if (!this.placeholder) return null;
    const bbox = new Box3().setFromObject(this.placeholder);
    if (
      !Number.isFinite(bbox.min.x) ||
      !Number.isFinite(bbox.min.y) ||
      !Number.isFinite(bbox.min.z) ||
      !Number.isFinite(bbox.max.x) ||
      !Number.isFinite(bbox.max.y) ||
      !Number.isFinite(bbox.max.z)
    ) {
      return null;
    }

    const center = bbox.getCenter(new Vector3());
    const halfSize = bbox.getSize(new Vector3()).multiplyScalar(0.5);
    const normal = surfaceHit.normal.clone().normalize();
    const projectedHalfDepth =
      Math.abs(normal.x) * halfSize.x +
      Math.abs(normal.y) * halfSize.y +
      Math.abs(normal.z) * halfSize.z;

    return center.addScaledVector(normal, -projectedHalfDepth);
  }

  requiresSurfaceSnap(): boolean {
    if (this.placeholder) {
      return requiresSurfaceSnap(this.placeholder);
    }
    const placementSnapPoints = getPlacementSnapPoints(this._options);
    return (placementSnapPoints || []).some(
      (snapPoint) => !!(snapPoint as any)?.surfaceSnap
    );
  }

  hasValidSurfaceSnap(): boolean {
    return !this.requiresSurfaceSnap() || this._hasValidSurfaceSnap;
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
      color: 0x6495ed,
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

    applyPlacementObjectIdentity(placeholder, this.id, this._options);

    const placeholderSnapPoints = getPlacementSnapPoints(this._options);
    if (placeholderSnapPoints) {
      try {
        placeholder.userData.snapPoints = placeholderSnapPoints;
      } catch (e) {
        // ignore
      }
    }
    markPlacementPlaceholderNonSelectable(placeholder);

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

  private _createPlaceholderAnchor(scene: any, element: any): Object3D {
    const placeholder = new Object3D();
    applyPlacementObjectIdentity(placeholder, this.id, this._options);

    markPlacementPlaceholderNonSelectable(placeholder);

    const placeholderSnapPoints = getPlacementSnapPoints(this._options);
    if (placeholderSnapPoints) {
      try {
        placeholder.userData.snapPoints = placeholderSnapPoints;
      } catch (e) {
        // ignore
      }
    }

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

        // No low-res URL and no bounds placeholder available.
        // Create a lightweight anchor placeholder so interactive snapping
        // (especially surfaceSnap) still works in getHighResUrl-only flows.
        const anchorPlaceholder = this._createPlaceholderAnchor(scene, element);
        this.placeholder = anchorPlaceholder;
        (this as any).dispatchEvent(
          new CustomEvent('placeholder-loaded', {
            detail: { sessionId: this.id, placeholder: anchorPlaceholder },
          })
        );
        this.log(
          '[puzzler] PlacementSession: No low-res URL provided, using anchor placeholder'
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
      applyPlacementObjectIdentity(placeholder, this.id, this._options);

      // If the placement was started with snapPoints, attach them to
      // the placeholder so the snapping-point slot renderer and snapping
      // logic can discover and use them during interactive placement.
      const placeholderSnapPoints = getPlacementSnapPoints(this._options);
      if (placeholderSnapPoints) {
        try {
          placeholder.userData.snapPoints = placeholderSnapPoints;
        } catch (e) {
          // ignore
        }
      }
      markPlacementPlaceholderNonSelectable(placeholder);

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
  // them to a world point on the placement plane.
  updatePosition(clientX: number, clientY: number) {
    if (!this._element) return;

    try {
      (this._element as any)._updateCursorFromPointer(clientX, clientY);

      const world = getMouseWorldPointOnPlacementPlane(
        this._element as unknown as HTMLElement,
        (this._element as any)[$scene],
        clientX,
        clientY
      );
      if (!world) {
        this._hasValidSurfaceSnap = false;
        // pointer outside or no valid ray intersection
        (this as any).dispatchEvent(
          new CustomEvent('update', {
            detail: { sessionId: this.id, worldPoint: null },
          })
        );
        return;
      }

      const cursorPos = (this._element as any)._getCursorWorldPosition?.() as
        | { x: number; y: number; z: number }
        | null;
      this._lastCursorPosition = cursorPos
        ? { ...cursorPos }
        : { x: world.x, y: world.y, z: world.z };
      // Also store this as the target bottom-center position
      this._targetBottomCenter = { x: world.x, y: world.y, z: world.z };

      // If no placeholder exists, just track position and return
      if (!this.placeholder) {
        this._hasValidSurfaceSnap = false;
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
      let bottomCenterLocal: Vector3;
      if (
        Number.isFinite(bboxLocal.min.x) &&
        Number.isFinite(bboxLocal.max.x) &&
        Number.isFinite(bboxLocal.min.y) &&
        Number.isFinite(bboxLocal.min.z) &&
        Number.isFinite(bboxLocal.max.z)
      ) {
        bottomCenterLocal = new Vector3(
          (bboxLocal.min.x + bboxLocal.max.x) / 2,
          bboxLocal.min.y,
          (bboxLocal.min.z + bboxLocal.max.z) / 2
        );
      } else {
        // Placeholder anchor (no mesh): treat local origin as bottom-center.
        bottomCenterLocal = new Vector3(0, 0, 0);
      }

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

      // Check for snapping during interactive placement.
      // Surface snap has priority and runs whenever required by the part,
      // even if generic point-to-point snapping is disabled.
      // Point-to-point snapping continues to honor `snappingEnabled`.
      this._hasValidSurfaceSnap = !this.requiresSurfaceSnap();
      let snappedSurfacePoint: Vector3 | null = null;
      if (this.placeholder) {
        try {
          if (requiresSurfaceSnap(this.placeholder)) {
            const surfaceHit = (
              this._element as any
            ).applySurfaceSnapForPlacement(this.placeholder, clientX, clientY);
            this._hasValidSurfaceSnap = !!surfaceHit;
            if (surfaceHit) {
              snappedSurfacePoint =
                this._getWallCursorPointFromPlaceholder(surfaceHit);
              if (!snappedSurfacePoint) {
                const snapPoint = getPrimarySurfaceSnapPoint(this.placeholder);
                if (snapPoint) {
                  snappedSurfacePoint = getSnappingPointWorldPosition(
                    this.placeholder,
                    snapPoint
                  );
                }
              }
              if (snappedSurfacePoint) {
                this._targetBottomCenter = {
                  x: snappedSurfacePoint.x,
                  y: snappedSurfacePoint.y,
                  z: snappedSurfacePoint.z,
                };
              }
            }
            (this._element as any).pendingSnapConnection = null;
          } else if (
            (this._element as any).snappingEnabled &&
            this.placeholder.userData.snapPoints
          ) {
            const targetObject = (this._element as any).findTargetObject();
            if (targetObject) {
              // Find potential snap targets by traversing all placed objects
              let bestConnection: any = null;
              targetObject.traverse((child: any) => {
                if (
                  child.userData.isPlacedObject &&
                  child !== this.placeholder &&
                  child.userData.snapPoints
                ) {
                  const connections = findSnappingConnections(
                    this.placeholder!,
                    child,
                    (object, snapPoint) =>
                      (this._element as any).isSnapPointUsed(object, snapPoint)
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

      const objectKey = getPlacementObjectKey(this.id, this._options);

      if (this.placeholder) {
        gltf.scene.quaternion.copy(this.placeholder.quaternion);
        gltf.scene.scale.copy(this.placeholder.scale);
        gltf.scene.name = this.placeholder.name || objectKey;
      } else {
        gltf.scene.name = objectKey;
      }

      const hasSurfaceSnappedPlaceholder =
        this.placeholder?.userData?.isSurfaceSnapped === true;

      if (this.placeholder && hasSurfaceSnappedPlaceholder) {
        // Preserve exact wall/surface placement transform from the placeholder.
        gltf.scene.position.copy(this.placeholder.position);
      } else if (this._targetBottomCenter) {
        // Align final GLB bottom-center to the tracked placement anchor so
        // placeholder and final-model origin differences do not cause offsets.
        const finalQuaternion = gltf.scene.quaternion.clone();
        const finalScale = gltf.scene.scale.clone();

        gltf.scene.position.set(0, 0, 0);
        gltf.scene.quaternion.set(0, 0, 0, 1);
        gltf.scene.scale.set(1, 1, 1);
        gltf.scene.updateMatrixWorld(true);
        const bboxLocal = new Box3().setFromObject(gltf.scene);
        const bottomCenterLocal = new Vector3(
          (bboxLocal.min.x + bboxLocal.max.x) / 2,
          bboxLocal.min.y,
          (bboxLocal.min.z + bboxLocal.max.z) / 2
        );

        gltf.scene.quaternion.copy(finalQuaternion);
        gltf.scene.scale.copy(finalScale);

        const target = (scene as any).target;
        if (target) {
          target.updateMatrixWorld(true);
        }
        const anchorWorld = new Vector3(
          this._targetBottomCenter.x,
          this._targetBottomCenter.y,
          this._targetBottomCenter.z
        );
        const anchorLocal = target
          ? target.worldToLocal(anchorWorld.clone())
          : anchorWorld.clone();
        const bottomOffsetLocal = bottomCenterLocal
          .clone()
          .multiply(gltf.scene.scale)
          .applyQuaternion(gltf.scene.quaternion);
        gltf.scene.position.copy(anchorLocal.sub(bottomOffsetLocal));
      } else if (this.placeholder) {
        gltf.scene.position.copy(this.placeholder.position);
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

      gltf.scene.userData = {
        selectable: getPlacementSelectable(this._options),
        selection: this._options?.selection || undefined,
        ...gltf.scene.userData,
        id: objectKey,
        name: getPlacementDisplayName(this._options) ?? objectKey,
        part: this._options?.part,
      };
      const placeholderUserData = this.placeholder?.userData || {};
      if (
        typeof placeholderUserData.attachedSurfaceType === 'string' &&
        placeholderUserData.attachedSurfaceType.length > 0
      ) {
        gltf.scene.userData.attachedSurfaceType =
          placeholderUserData.attachedSurfaceType;
      }
      if (
        typeof placeholderUserData.attachedSurfaceName === 'string' &&
        placeholderUserData.attachedSurfaceName.length > 0
      ) {
        gltf.scene.userData.attachedSurfaceName =
          placeholderUserData.attachedSurfaceName;
      }
      if (
        typeof placeholderUserData.attachedSurfaceUuid === 'string' &&
        placeholderUserData.attachedSurfaceUuid.length > 0
      ) {
        gltf.scene.userData.attachedSurfaceUuid =
          placeholderUserData.attachedSurfaceUuid;
      }
      if (
        typeof placeholderUserData.attachedWallName === 'string' &&
        placeholderUserData.attachedWallName.length > 0
      ) {
        gltf.scene.userData.attachedWallName =
          placeholderUserData.attachedWallName;
      }
      if (
        typeof placeholderUserData.attachedWallUuid === 'string' &&
        placeholderUserData.attachedWallUuid.length > 0
      ) {
        gltf.scene.userData.attachedWallUuid =
          placeholderUserData.attachedWallUuid;
      }
      const placedSnapPoints = getPlacementSnapPoints(this._options);
      if (placedSnapPoints) {
        try {
          gltf.scene.userData.snapPoints = placedSnapPoints;
        } catch (e) {}
      }
      gltf.scene.userData.isPlacedObject = true;

      try {
        scene.target.add(gltf.scene);
      } catch (e) {
        scene.add(gltf.scene);
      }

      if (
        requiresSurfaceSnap(gltf.scene) &&
        !hasSurfaceSnappedPlaceholder
      ) {
        try {
          const roomObject = element._findRoomSurfaceObject?.();
          if (
            roomObject &&
            tryResnapToNearestWall(gltf.scene, roomObject)
          ) {
            element._markRoomWallVisibilityCacheDirty?.();
          }
        } catch (e) {}
      }

      gltf.scene.userData.isSurfaceSnapped =
        this.requiresSurfaceSnap() &&
        (this._hasValidSurfaceSnap ||
          gltf.scene.userData?.isSurfaceSnapped === true);

      try {
        element._markRoomWallVisibilityCacheDirty?.();
      } catch (e) {}

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
                  child.userData?.snapPoints
                )
                  snappableObjects.push(child);
              });
            } else if ((gltf.scene as any).userData?.snapPoints) {
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
                    child.userData?.snapPoints
                  ) {
                    const connections = findSnappingConnections(
                      snappableObj,
                      child,
                      (object, snapPoint) =>
                        el.isSnapPointUsed(object, snapPoint)
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
      try {
        element._recordPlacementAdd?.(gltf.scene);
      } catch (e) {}
      (this as any).dispatchEvent(new CustomEvent('loaded', { detail }));
      return { id: objectKey, node: gltf.scene };
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
    const el = element || this._element;
    const placeholderRef = this.placeholder;
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

    if (el) {
      try {
        const selected = ((el as any).selectedObjects || []) as Object3D[];
        if (
          selected.some(
            (obj) =>
              obj === placeholderRef ||
              obj?.userData?.isPlacementPlaceholder === true
          )
        ) {
          (el as any).clearSelection?.();
        }
      } catch (e) {}
      (el as any)[$needsRender]();
    }
  }

  private _endInteractive() {
    const el = this._element;
    this._element = null;
    if (el) {
      try {
        (el as any)._syncCursorLifecycle?.();
      } catch (e) {}
    }
  }
}
