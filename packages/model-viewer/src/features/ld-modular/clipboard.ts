import {Box3, Object3D, Quaternion, Vector3} from 'three';
import type {Part, SnapPoint} from '@london-dynamics/types/planner';
import type {Selection} from '@london-dynamics/types/puzzler';
import {
  allowsSurfaceType,
  requiresSurfaceSnap,
  type SurfaceType,
} from '../../utilities/snapping-points.js';
import {getObjectDisplayName} from './transform-events.js';
import {cloneMeshMaterials, restoreCommittedMeshRendering} from './overlay-rendering.js';
import {scrubSelectionOutlineLayers} from '../ld-selection/selection-outline-layers.js';

export type ClipboardEntryKind = 'part' | 'group' | 'selection';

export type SelectionClipboardItem = {
  itemEntry: ClipboardEntry;
  anchorOffset: Vector3;
};

export type SelectionClipboardPayload = {
  items: SelectionClipboardItem[];
  leaderIndex: number;
};

export type GroupChildClipboardPayload = {
  oldName: string;
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  selectable?: boolean;
  localPosition: Vector3;
  localQuaternion: Quaternion;
  localScale: Vector3;
};

export type GroupClipboardPayload = {
  snapConnections: Record<string, unknown>[];
  children: GroupChildClipboardPayload[];
};

export type ClipboardEntry = {
  kind: ClipboardEntryKind;
  sourceUuid: string;
  displayName?: string;
  requiresSurfaceSnap: boolean;
  allowedSurfaces: SurfaceType[];
  /** Detached Object3D.clone(true) — shares GPU buffers, not in scene. */
  prototype: Object3D;
  groupPayload?: GroupClipboardPayload;
  selectionPayload?: SelectionClipboardPayload;
};

export type ClipboardStateEntry = {
  kind: ClipboardEntryKind;
  sourceUuid: string;
  displayName?: string;
  requiresSurfaceSnap: boolean;
  allowedSurfaces?: SurfaceType[];
};

export type ClipboardPasteSessionState = {
  active: boolean;
  state: 'previewing' | 'committing';
  validTarget: boolean;
};

export type ClipboardState = {
  hasClipboard: boolean;
  entry?: ClipboardStateEntry;
  pasteSession?: ClipboardPasteSessionState;
};

export type ClipboardChangeReason =
  | 'copy'
  | 'clear'
  | 'paste-start'
  | 'paste-update'
  | 'paste-commit'
  | 'paste-cancel';

export type ClipboardChangeDetail = ClipboardState & {
  reason: ClipboardChangeReason;
};

function clonePlain<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch (_e) {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function cloneSnapConnections(
  connections: unknown[] | undefined
): Record<string, unknown>[] {
  if (!Array.isArray(connections)) return [];
  return connections.map((connection) => clonePlain(connection) as Record<string, unknown>);
}

function collectAllowedSurfaces(object: Object3D): SurfaceType[] {
  const surfaces = new Set<SurfaceType>();
  const snapPoints = object.userData?.snapPoints as SnapPoint[] | undefined;
  if (Array.isArray(snapPoints)) {
    for (const snapPoint of snapPoints) {
      const allowed = (snapPoint as {allowedSurfaces?: SurfaceType[]})
        .allowedSurfaces;
      if (Array.isArray(allowed)) {
        for (const surface of allowed) surfaces.add(surface);
      }
    }
  }
  if (surfaces.size === 0 && requiresSurfaceSnap(object)) {
    surfaces.add('wall');
  }
  if (surfaces.size === 0) {
    surfaces.add('floor');
  }
  return [...surfaces];
}

function snapshotPartUserData(source: Object3D): {
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  selectable?: boolean;
} {
  const userData = source.userData || {};
  return {
    part: clonePlain(userData.part as Partial<Part> | undefined),
    selection: clonePlain(userData.selection as Selection | undefined),
    snapPoints: clonePlain(userData.snapPoints as SnapPoint[] | undefined),
    selectable:
      typeof userData.selectable === 'boolean' ? userData.selectable : undefined,
  };
}

function applyPartUserData(
  target: Object3D,
  payload: ReturnType<typeof snapshotPartUserData>
): void {
  target.userData = target.userData || {};
  if (payload.part !== undefined) target.userData.part = payload.part;
  if (payload.selection !== undefined) target.userData.selection = payload.selection;
  if (payload.snapPoints !== undefined) {
    target.userData.snapPoints = payload.snapPoints;
  }
  if (payload.selectable !== undefined) {
    target.userData.selectable = payload.selectable;
  }
}

function stripRuntimeUserData(node: Object3D): void {
  const userData = node.userData || {};
  delete userData.isPasteGhost;
  delete userData.isPlacementPlaceholder;
  delete userData.attachedSurfaceType;
  delete userData.attachedSurfaceName;
  delete userData.attachedSurfaceUuid;
  delete userData.attachedWallName;
  delete userData.attachedWallUuid;
  delete userData.isSurfaceSnapped;
  delete userData.groupId;
  delete userData.isInGroup;
}

function preparePrototypeClone(source: Object3D): Object3D {
  const prototype = source.clone(true);
  scrubSelectionOutlineLayers(prototype);
  cloneMeshMaterials(prototype);
  prototype.traverse((child) => {
    stripRuntimeUserData(child);
    if (child.userData?.isPlacedObject === true) {
      const payload = snapshotPartUserData(child);
      applyPartUserData(child, payload);
    }
  });
  stripRuntimeUserData(prototype);
  return prototype;
}

export function isClipboardCopyTarget(node: Object3D | null): node is Object3D {
  if (!node) return false;
  if (node.userData?.isSnappedGroup === true) return true;
  return node.userData?.isPlacedObject === true;
}

export function getObjectBottomCenterWorld(object: Object3D): Vector3 {
  object.updateMatrixWorld(true);
  const bbox = new Box3().setFromObject(object);
  if (
    !Number.isFinite(bbox.min.x) ||
    !Number.isFinite(bbox.max.x) ||
    !Number.isFinite(bbox.min.y) ||
    !Number.isFinite(bbox.max.y) ||
    !Number.isFinite(bbox.min.z) ||
    !Number.isFinite(bbox.max.z)
  ) {
    const fallback = new Vector3();
    object.getWorldPosition(fallback);
    return fallback;
  }
  return new Vector3(
    (bbox.min.x + bbox.max.x) / 2,
    bbox.min.y,
    (bbox.min.z + bbox.max.z) / 2
  );
}

function unionAllowedSurfaces(entries: ClipboardEntry[]): SurfaceType[] {
  const surfaces = new Set<SurfaceType>();
  for (const entry of entries) {
    for (const surface of entry.allowedSurfaces) {
      surfaces.add(surface);
    }
  }
  return [...surfaces];
}

function pickSelectionLeaderIndex(entries: ClipboardEntry[]): number {
  const floorIndex = entries.findIndex((entry) => !entry.requiresSurfaceSnap);
  return floorIndex >= 0 ? floorIndex : 0;
}

export function snapshotClipboardTargets(
  sources: Object3D[]
): ClipboardEntry | null {
  const roots = sources.filter((source) => isClipboardCopyTarget(source));
  if (roots.length === 0) return null;
  if (roots.length === 1) return snapshotClipboardEntry(roots[0]);

  const itemEntries = roots
    .map((root) => snapshotClipboardEntry(root))
    .filter((entry): entry is ClipboardEntry => !!entry);
  if (itemEntries.length === 0) return null;

  const leaderIndex = pickSelectionLeaderIndex(itemEntries);
  const anchorWorld = getObjectBottomCenterWorld(roots[leaderIndex]);
  const items: SelectionClipboardItem[] = itemEntries.map((itemEntry, index) => ({
    itemEntry,
    anchorOffset: getObjectBottomCenterWorld(roots[index]).sub(anchorWorld),
  }));

  const displayName = `${itemEntries.length} items`;

  return {
    kind: 'selection',
    sourceUuid: itemEntries.map((entry) => entry.sourceUuid).join(','),
    displayName,
    requiresSurfaceSnap: itemEntries.some((entry) => entry.requiresSurfaceSnap),
    allowedSurfaces: unionAllowedSurfaces(itemEntries),
    prototype: new Object3D(),
    selectionPayload: {
      items,
      leaderIndex,
    },
  };
}

export function snapshotClipboardEntry(source: Object3D): ClipboardEntry | null {
  if (!isClipboardCopyTarget(source)) return null;

  const isGroup = source.userData?.isSnappedGroup === true;
  const prototype = preparePrototypeClone(source);
  const allowedSurfaces = collectAllowedSurfaces(source);
  const requiresSnap = requiresSurfaceSnap(source);

  if (isGroup) {
    const children: GroupChildClipboardPayload[] = [];
    source.traverse((child) => {
      if (child === source) return;
      if (child.userData?.isPlacedObject !== true) return;
      const payload = snapshotPartUserData(child);
      children.push({
        oldName: child.name,
        ...payload,
        localPosition: child.position.clone(),
        localQuaternion: child.quaternion.clone(),
        localScale: child.scale.clone(),
      });
    });

    return {
      kind: 'group',
      sourceUuid: source.uuid,
      displayName: getObjectDisplayName(source),
      requiresSurfaceSnap: requiresSnap,
      allowedSurfaces,
      prototype,
      groupPayload: {
        snapConnections: cloneSnapConnections(
          source.userData?.snapConnections as unknown[] | undefined
        ),
        children,
      },
    };
  }

  const payload = snapshotPartUserData(source);
  applyPartUserData(prototype, payload);

  return {
    kind: 'part',
    sourceUuid: source.uuid,
    displayName: getObjectDisplayName(source),
    requiresSurfaceSnap: requiresSnap,
    allowedSurfaces,
    prototype,
  };
}

export function disposeClipboardEntry(entry: ClipboardEntry | null): void {
  if (!entry) return;
  if (entry.kind === 'selection' && entry.selectionPayload) {
    for (const item of entry.selectionPayload.items) {
      disposeClipboardEntry(item.itemEntry);
    }
  }
  entry.prototype.traverse((child) => {
    const mesh = child as {isMesh?: boolean; geometry?: {dispose?: () => void}};
    if (mesh.isMesh && mesh.geometry?.dispose) {
      // Shared geometry — do not dispose buffers; only drop references.
    }
  });
  entry.prototype.clear();
}

export function toClipboardStateEntry(
  entry: ClipboardEntry
): ClipboardStateEntry {
  return {
    kind: entry.kind,
    sourceUuid: entry.sourceUuid,
    displayName: entry.displayName,
    requiresSurfaceSnap: entry.requiresSurfaceSnap,
    allowedSurfaces: entry.allowedSurfaces,
  };
}

export function createSessionId(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export type CommitPasteIdentityOptions = {
  part?: Partial<Part>;
  selection?: Selection;
  snapPoints?: SnapPoint[];
  name?: string;
  id?: string;
  selectable?: boolean;
};

export function applyCommittedPasteIdentity(
  object: Object3D,
  sessionId: string,
  options?: CommitPasteIdentityOptions
): string {
  const objectKey = options?.id || sessionId;
  object.name = objectKey;
  object.userData = object.userData || {};
  object.userData.id = objectKey;
  const displayName =
    options?.name ??
    (options?.part as {name?: string} | undefined)?.name;
  if (displayName !== undefined) {
    object.userData.name = displayName;
  }
  if (options?.part !== undefined) object.userData.part = options.part;
  if (options?.selection !== undefined) {
    object.userData.selection = options.selection;
  }
  if (options?.snapPoints !== undefined) {
    object.userData.snapPoints = options.snapPoints;
  }
  object.userData.isPlacedObject = true;
  object.userData.selectable =
    options?.selectable !== undefined ? options.selectable : true;
  delete object.userData.isPasteGhost;
  return objectKey;
}

export function commitPasteClone(
  entry: ClipboardEntry,
  sessionId: string
): Object3D {
  if (entry.kind === 'selection') {
    throw new Error('Use commitPasteTargets for selection clipboard entries');
  }

  const node = entry.prototype.clone(true);
  scrubSelectionOutlineLayers(node);
  cloneMeshMaterials(node);
  restoreCommittedMeshRendering(node);

  if (entry.kind === 'group' && entry.groupPayload) {
    const groupName = `group_${Date.now()}`;
    node.name = groupName;
    node.userData = node.userData || {};
    node.userData.isSnappedGroup = true;
    node.userData.snapConnections = [];

    const nameMap = new Map<string, string>();
    const childPayloadByOldName = new Map(
      entry.groupPayload.children.map((child) => [child.oldName, child])
    );

    node.traverse((child) => {
      if (child === node) return;
      if (child.userData?.isPlacedObject !== true) return;
      const oldName = child.name;
      const payload = childPayloadByOldName.get(oldName);
      const childSessionId = `${sessionId}_${oldName}`;
      const childKey = applyCommittedPasteIdentity(child, childSessionId, {
        part: payload?.part,
        selection: payload?.selection,
        snapPoints: payload?.snapPoints,
        selectable: payload?.selectable,
      });
      nameMap.set(oldName, childKey);
      child.userData.isInGroup = true;
      child.userData.groupId = groupName;
      if (payload) {
        child.position.copy(payload.localPosition);
        child.quaternion.copy(payload.localQuaternion);
        child.scale.copy(payload.localScale);
      }
    });

    const remappedConnections = entry.groupPayload.snapConnections.map(
      (connection) => {
        const next = {...connection};
        if (typeof next.a === 'string' && nameMap.has(next.a)) {
          next.a = nameMap.get(next.a)!;
        }
        if (typeof next.b === 'string' && nameMap.has(next.b)) {
          next.b = nameMap.get(next.b)!;
        }
        return next;
      }
    );
    node.userData.snapConnections = remappedConnections;
    return node;
  }

  const payload = snapshotPartUserData(entry.prototype);
  applyCommittedPasteIdentity(node, sessionId, {
    part: payload.part,
    selection: payload.selection,
    snapPoints: payload.snapPoints,
    selectable: payload.selectable,
    name: entry.displayName,
  });
  return node;
}

export function commitPasteTargets(
  entry: ClipboardEntry,
  sessionId: string
): Array<{node: Object3D; itemEntry: ClipboardEntry}> {
  if (entry.kind === 'selection' && entry.selectionPayload) {
    return entry.selectionPayload.items.map((item, index) => ({
      node: commitPasteClone(item.itemEntry, `${sessionId}_${index}`),
      itemEntry: item.itemEntry,
    }));
  }

  return [{node: commitPasteClone(entry, sessionId), itemEntry: entry}];
}

export function getSelectionClipboardItems(
  entry: ClipboardEntry
): SelectionClipboardItem[] {
  if (entry.kind === 'selection' && entry.selectionPayload) {
    return entry.selectionPayload.items;
  }
  return [{itemEntry: entry, anchorOffset: new Vector3()}];
}

export function getSelectionLeaderIndex(entry: ClipboardEntry): number {
  if (entry.kind === 'selection' && entry.selectionPayload) {
    return entry.selectionPayload.leaderIndex;
  }
  return 0;
}

export function entryRequiresSurfaceSnap(entry: ClipboardEntry): boolean {
  return entry.requiresSurfaceSnap;
}

export function getEntryPrimarySnapPoint(entry: ClipboardEntry): SnapPoint | null {
  const snapPoints = entry.prototype.userData?.snapPoints as
    | SnapPoint[]
    | undefined;
  if (Array.isArray(snapPoints) && snapPoints.length > 0) {
    const surfacePoint = snapPoints.find((point) => !!(point as any)?.surfaceSnap);
    return surfacePoint ?? snapPoints[0];
  }
  if (entry.kind === 'group') {
    for (const child of entry.groupPayload?.children ?? []) {
      const points = child.snapPoints;
      if (!Array.isArray(points) || points.length === 0) continue;
      const surfacePoint = points.find((point) => !!(point as any)?.surfaceSnap);
      return surfacePoint ?? points[0];
    }
  }
  if (entry.kind === 'selection' && entry.selectionPayload) {
    for (const item of entry.selectionPayload.items) {
      const snapPoint = getEntryPrimarySnapPoint(item.itemEntry);
      if (snapPoint) return snapPoint;
    }
  }
  return null;
}

export function entryAllowsSurface(
  entry: ClipboardEntry,
  surfaceType: SurfaceType
): boolean {
  const snapPoint = getEntryPrimarySnapPoint(entry);
  if (!snapPoint) return surfaceType === 'floor';
  return allowsSurfaceType(snapPoint, surfaceType);
}
